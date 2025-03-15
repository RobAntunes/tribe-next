"""
CodebaseIndexer for building and querying a searchable index of the codebase.
"""

import os
import json
import time
import re
import logging
from typing import Dict, List, Any, Optional, Set, Tuple, Union
from pathlib import Path
import threading
import sqlite3
from concurrent.futures import ThreadPoolExecutor
import ast
from dataclasses import dataclass, field, asdict

# Setup logging
logger = logging.getLogger(__name__)

@dataclass
class SymbolInfo:
    """Information about a code symbol (function, class, etc.)"""
    name: str
    type: str  # "function", "class", "method", "variable", etc.
    file_path: str
    line_start: int
    line_end: int
    column_start: int = 0
    column_end: int = 0
    signature: str = ""
    docstring: str = ""
    parent: str = ""  # Parent class/module
    references: List[str] = field(default_factory=list)  # List of places this symbol is referenced
    imports: List[str] = field(default_factory=list)  # List of imports used by this symbol
    code: str = ""  # The actual code
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class FileInfo:
    """Information about a file in the codebase"""
    path: str
    language: str
    size: int
    modified_time: float
    symbols: List[SymbolInfo] = field(default_factory=list)
    imports: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    metrics: Dict[str, Any] = field(default_factory=dict)
    content_hash: str = ""

class CodebaseIndexer:
    """
    Builds and maintains a searchable index of code structures, dependencies, and relationships.
    Uses SQLite for storage and provides a query interface for efficient codebase exploration.
    """
    
    def __init__(self, workspace_root: str, db_path: Optional[str] = None):
        """
        Initialize the indexer with the workspace root path
        
        Args:
            workspace_root: Root directory of the workspace to index
            db_path: Path to the SQLite database file (defaults to .tribe/codebase_index.db)
        """
        self.workspace_root = workspace_root
        
        # Default DB path in the .tribe directory
        if db_path is None:
            tribe_dir = os.path.join(workspace_root, '.tribe')
            os.makedirs(tribe_dir, exist_ok=True)
            db_path = os.path.join(tribe_dir, 'codebase_index.db')
            
        self.db_path = db_path
        self.conn = None
        self.index_lock = threading.Lock()
        self.indexing_in_progress = False
        self.last_indexed = 0
        self.file_count = 0
        self.symbol_count = 0
        self._thread_local = threading.local() # Thread-local storage for SQLite connections
        
        # Language parsers
        self.language_map = {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.jsx': 'javascript',
            '.java': 'java',
            '.c': 'c',
            '.cpp': 'cpp',
            '.h': 'c',
            '.hpp': 'cpp',
            '.cs': 'csharp',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.sh': 'bash',
            '.html': 'html',
            '.css': 'css',
            '.json': 'json',
            '.md': 'markdown',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
        }
        
        # Ignored directories
        self.ignored_dirs = set([
            '.git', 'node_modules', 'venv', 'env', '__pycache__', 
            'dist', 'build', '.idea', '.vscode', '.pytest_cache',
            'out', 'bin', 'obj', '.DS_Store'
        ])
        
        # Initialize database
        self._init_database()
        
    def _init_database(self):
        """Initialize the SQLite database schema"""
        try:
            # Create a new connection for the main thread
            self.conn = sqlite3.connect(self.db_path)
            # Store it in thread_local for the current thread
            self._thread_local.conn = self.conn
            cursor = self.conn.cursor()
            
            # Files table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY,
                path TEXT UNIQUE,
                language TEXT,
                size INTEGER,
                modified_time REAL,
                content_hash TEXT,
                indexed_time REAL
            )
            ''')
            
            # Symbols table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY,
                name TEXT,
                type TEXT,
                file_id INTEGER,
                line_start INTEGER,
                line_end INTEGER,
                column_start INTEGER,
                column_end INTEGER,
                signature TEXT,
                docstring TEXT,
                parent TEXT,
                code TEXT,
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
            ''')
            
            # Create indexes
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols (name)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols (type)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_path ON files (path)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_files_language ON files (language)')
            
            # Dependencies table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS dependencies (
                id INTEGER PRIMARY KEY,
                source_file_id INTEGER,
                target TEXT,
                type TEXT,
                FOREIGN KEY (source_file_id) REFERENCES files(id)
            )
            ''')
            
            # References table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS symbol_references (
                id INTEGER PRIMARY KEY,
                symbol_id INTEGER,
                file_id INTEGER,
                line INTEGER,
                column INTEGER,
                FOREIGN KEY (symbol_id) REFERENCES symbols(id),
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
            ''')
            
            # Metadata table
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            ''')
            
            self.conn.commit()
            
            # Initialize metadata
            try:
                cursor.execute('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)', 
                            ('last_indexed', '0'))
                cursor.execute('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)', 
                            ('version', '1.0'))
                cursor.execute('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)', 
                            ('file_count', '0'))
                cursor.execute('INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)', 
                            ('symbol_count', '0'))
                self.conn.commit()
                
                # Load metadata
                cursor.execute('SELECT value FROM metadata WHERE key = ?', ('last_indexed',))
                row = cursor.fetchone()
                if row:
                    self.last_indexed = float(row[0])
                    
                cursor.execute('SELECT value FROM metadata WHERE key = ?', ('file_count',))
                row = cursor.fetchone()
                if row:
                    self.file_count = int(row[0])
                    
                cursor.execute('SELECT value FROM metadata WHERE key = ?', ('symbol_count',))
                row = cursor.fetchone()
                if row:
                    self.symbol_count = int(row[0])
                
            except sqlite3.Error as e:
                logger.error(f"Error initializing metadata: {e}")
            
        except sqlite3.Error as e:
            logger.error(f"Database initialization error: {e}")
            if self.conn:
                self.conn.close()
            raise
    
    def estimate_files(self, max_file_size: int = 1024 * 1024) -> int:
        """
        Estimate the number of files that would be indexed
        
        Args:
            max_file_size: Maximum file size to index in bytes (default 1MB)
            
        Returns:
            int: Estimated number of files to index
        """
        total_files = 0
        
        try:
            for root, dirs, files in os.walk(self.workspace_root):
                # Skip ignored directories
                dirs[:] = [d for d in dirs if d not in self.ignored_dirs and not d.startswith('.')]
                
                for file in files:
                    file_path = os.path.join(root, file)
                    
                    # Skip files without recognized extensions
                    ext = os.path.splitext(file)[1].lower()
                    if ext not in self.language_map:
                        continue
                    
                    # Skip files that are too large
                    try:
                        size = os.path.getsize(file_path)
                        if size > max_file_size:
                            continue
                    except OSError:
                        continue
                        
                    total_files += 1
            
            return total_files
        except Exception as e:
            logger.error(f"Error estimating files: {e}")
            return 100  # Return a default value if estimation fails
    
    def index_workspace(self, force: bool = False, max_file_size: int = 1024 * 1024, progress_callback=None):
        """
        Index the entire workspace or update changed files
        
        Args:
            force: If True, reindex everything even if it hasn't changed
            max_file_size: Maximum file size to index in bytes (default 1MB)
            progress_callback: Optional callback function to report progress
                              Function signature: (processed_files, total_files, current_file)
        """
        with self.index_lock:
            if self.indexing_in_progress:
                logger.warning("Indexing already in progress, skipping")
                return False
                
            # Reset counters at the start of indexing
            if force:
                self.file_count = 0
                self.symbol_count = 0
                
            self.indexing_in_progress = True
        
        try:
            start_time = time.time()
            logger.info(f"Starting codebase indexing of {self.workspace_root}")
            
            # Get all files in the workspace
            all_files = []
            for root, dirs, files in os.walk(self.workspace_root):
                # Skip ignored directories
                dirs[:] = [d for d in dirs if d not in self.ignored_dirs and not d.startswith('.')]
                
                for file in files:
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, self.workspace_root)
                    
                    # Skip files without recognized extensions
                    ext = os.path.splitext(file)[1].lower()
                    if ext not in self.language_map:
                        continue
                    
                    # Skip files that are too large
                    try:
                        size = os.path.getsize(file_path)
                        if size > max_file_size:
                            logger.info(f"Skipping large file: {rel_path} ({size} bytes)")
                            continue
                    except OSError:
                        continue
                    
                    # Check if file has been modified since last indexing
                    modified_time = os.path.getmtime(file_path)
                    if not force and modified_time < self.last_indexed:
                        continue
                    
                    all_files.append((file_path, rel_path, modified_time, ext))
            
            total_files = len(all_files)
            processed_files = 0
            
            # Log the total files being indexed
            logger.info(f"Indexing {total_files} files")
            
            # Report initial progress with 0 processed files
            if progress_callback:
                progress_callback(processed_files, total_files, "")
            
            # Index files using thread pool
            with ThreadPoolExecutor(max_workers=os.cpu_count()) as executor:
                # Submit all indexing tasks
                futures = []
                for file_path, rel_path, modified_time, ext in all_files:
                    futures.append(executor.submit(
                        self._index_file, file_path, rel_path, modified_time, ext
                    ))
                
                # Process results as they complete
                for i, future in enumerate(futures):
                    future.result()
                    processed_files += 1
                    
                    # Get current file being processed
                    current_file = all_files[i][1] if i < len(all_files) else ""
                    
                    # Report progress more frequently for better UX
                    if progress_callback:
                        # Always report progress for proper UI updates
                        # For small codebases report every file, for larger ones report regularly
                        should_report = (total_files < 50 or 
                                        processed_files % 3 == 0 or
                                        processed_files == 1 or  # First file
                                        processed_files == total_files or  # Last file
                                        i == 0 or  # First file (different way to check)
                                        i == len(futures) - 1)  # Last file
                        
                        if should_report:
                            logger.info(f"Progress update: {processed_files}/{total_files} files - {current_file}")
                            progress_callback(processed_files, total_files, current_file)
            
            # Update metadata
            self._update_metadata(time.time())
            
            # Report final progress with a completion message
            if progress_callback:
                progress_callback(total_files, total_files, "Indexing completed successfully!")
            
            end_time = time.time()
            logger.info(f"Finished indexing codebase in {end_time - start_time:.2f} seconds")
            logger.info(f"Indexed {self.file_count} files with {self.symbol_count} symbols")
            
            return True
            
        except Exception as e:
            logger.error(f"Error during indexing: {e}")
            # If there's an error, still report progress to show the error in the UI
            if progress_callback:
                try:
                    progress_callback(processed_files, total_files, f"Error: {str(e)}")
                except:
                    pass
            return False
        finally:
            self.indexing_in_progress = False
    
    def _index_file(self, file_path: str, rel_path: str, modified_time: float, ext: str):
        """Index a single file"""
        try:
            # Get file info
            size = os.path.getsize(file_path)
            language = self.language_map.get(ext, 'unknown')
            
            # Read file contents
            with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            
            # Hash content for change detection
            import hashlib
            content_hash = hashlib.md5(content.encode('utf-8')).hexdigest()
            
            # Create thread-local connection if it doesn't exist
            if not hasattr(self._thread_local, 'conn'):
                self._thread_local.conn = sqlite3.connect(self.db_path)
            
            cursor = self._thread_local.conn.cursor()
            
            # Check if file exists in database
            cursor.execute('SELECT id, content_hash FROM files WHERE path = ?', (rel_path,))
            row = cursor.fetchone()
            
            if row and row[1] == content_hash:
                # File exists and hasn't changed
                file_id = row[0]
                cursor.execute('UPDATE files SET indexed_time = ? WHERE id = ?', 
                             (time.time(), file_id))
                self.conn.commit()
                return
            
            # Parse file based on language
            symbols = []
            imports = []
            dependencies = []
            
            if language == 'python':
                symbols, imports, dependencies = self._parse_python(content, rel_path)
            elif language in ('javascript', 'typescript'):
                symbols, imports, dependencies = self._parse_js_ts(content, rel_path)
            # Add more language parsers as needed
            
            # Begin transaction
            self._thread_local.conn.execute('BEGIN TRANSACTION')
            
            if row:
                # Update existing file
                file_id = row[0]
                cursor.execute('''
                UPDATE files SET 
                    language = ?, 
                    size = ?, 
                    modified_time = ?,
                    content_hash = ?,
                    indexed_time = ?
                WHERE id = ?
                ''', (language, size, modified_time, content_hash, time.time(), file_id))
                
                # Delete old symbols and references
                cursor.execute('DELETE FROM symbols WHERE file_id = ?', (file_id,))
                cursor.execute('DELETE FROM dependencies WHERE source_file_id = ?', (file_id,))
            else:
                # Insert new file
                cursor.execute('''
                INSERT INTO files 
                    (path, language, size, modified_time, content_hash, indexed_time) 
                VALUES (?, ?, ?, ?, ?, ?)
                ''', (rel_path, language, size, modified_time, content_hash, time.time()))
                file_id = cursor.lastrowid
                
                # Update file count
                self.file_count += 1
            
            # Add symbols
            for symbol in symbols:
                cursor.execute('''
                INSERT INTO symbols 
                    (name, type, file_id, line_start, line_end, column_start, column_end, 
                     signature, docstring, parent, code) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    symbol.name, symbol.type, file_id, symbol.line_start, symbol.line_end,
                    symbol.column_start, symbol.column_end, symbol.signature, 
                    symbol.docstring, symbol.parent, symbol.code
                ))
                symbol_id = cursor.lastrowid
                self.symbol_count += 1
                
                # Add references (if available)
                for ref in symbol.references:
                    # Parse reference information
                    pass  # Implement reference tracking
            
            # Add dependencies
            for dep in dependencies:
                cursor.execute('''
                INSERT INTO dependencies (source_file_id, target, type)
                VALUES (?, ?, ?)
                ''', (file_id, dep, 'import'))
            
            # Commit transaction
            self._thread_local.conn.commit()
            
        except Exception as e:
            # Use thread-local connection for rollback
            if hasattr(self._thread_local, 'conn'):
                self._thread_local.conn.rollback()
            logger.error(f"Error indexing file {rel_path}: {e}")
    
    def _update_metadata(self, timestamp: float):
        """Update indexing metadata"""
        try:
            # Use thread-local connection for metadata updates to avoid thread issues
            if not hasattr(self._thread_local, 'conn'):
                self._thread_local.conn = sqlite3.connect(self.db_path)
            
            cursor = self._thread_local.conn.cursor()
            cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', 
                         (str(timestamp), 'last_indexed'))
            cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', 
                         (str(self.file_count), 'file_count'))
            cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', 
                         (str(self.symbol_count), 'symbol_count'))
            self._thread_local.conn.commit()
            self.last_indexed = timestamp
        except sqlite3.Error as e:
            logger.error(f"Error updating metadata: {e}")
    
    def _parse_python(self, content: str, file_path: str) -> Tuple[List[SymbolInfo], List[str], List[str]]:
        """Parse Python file to extract symbols, imports and dependencies"""
        symbols = []
        imports = []
        dependencies = []
        
        try:
            tree = ast.parse(content)
            
            # Extract imports
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for name in node.names:
                        imports.append(name.name)
                        dependencies.append(name.name)
                elif isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    for name in node.names:
                        imports.append(f"{module}.{name.name}")
                        dependencies.append(f"{module}.{name.name}")
            
            # Extract classes and functions
            for node in ast.iter_child_nodes(tree):
                if isinstance(node, ast.ClassDef):
                    # Extract class info
                    class_name = node.name
                    line_start = node.lineno
                    line_end = self._find_end_line(content, node)
                    
                    # Get docstring
                    docstring = ast.get_docstring(node) or ""
                    
                    # Get class code
                    class_lines = content.splitlines()[line_start-1:line_end]
                    class_code = "\n".join(class_lines)
                    
                    class_symbol = SymbolInfo(
                        name=class_name,
                        type="class",
                        file_path=file_path,
                        line_start=line_start,
                        line_end=line_end,
                        docstring=docstring,
                        code=class_code
                    )
                    symbols.append(class_symbol)
                    
                    # Extract methods
                    for method in [n for n in ast.iter_child_nodes(node) if isinstance(n, ast.FunctionDef)]:
                        method_name = method.name
                        method_line_start = method.lineno
                        method_line_end = self._find_end_line(content, method)
                        
                        # Get method docstring
                        method_docstring = ast.get_docstring(method) or ""
                        
                        # Get method signature
                        args = [a.arg for a in method.args.args]
                        signature = f"{method_name}({', '.join(args)})"
                        
                        # Get method code
                        method_lines = content.splitlines()[method_line_start-1:method_line_end]
                        method_code = "\n".join(method_lines)
                        
                        method_symbol = SymbolInfo(
                            name=method_name,
                            type="method",
                            file_path=file_path,
                            line_start=method_line_start,
                            line_end=method_line_end,
                            signature=signature,
                            docstring=method_docstring,
                            parent=class_name,
                            code=method_code
                        )
                        symbols.append(method_symbol)
                
                elif isinstance(node, ast.FunctionDef):
                    # Extract function info
                    func_name = node.name
                    line_start = node.lineno
                    line_end = self._find_end_line(content, node)
                    
                    # Get docstring
                    docstring = ast.get_docstring(node) or ""
                    
                    # Get function signature
                    args = [a.arg for a in node.args.args]
                    signature = f"{func_name}({', '.join(args)})"
                    
                    # Get function code
                    func_lines = content.splitlines()[line_start-1:line_end]
                    func_code = "\n".join(func_lines)
                    
                    func_symbol = SymbolInfo(
                        name=func_name,
                        type="function",
                        file_path=file_path,
                        line_start=line_start,
                        line_end=line_end,
                        signature=signature,
                        docstring=docstring,
                        code=func_code
                    )
                    symbols.append(func_symbol)
        
        except SyntaxError as e:
            logger.warning(f"Syntax error in Python file {file_path}: {e}")
        except Exception as e:
            logger.error(f"Error parsing Python file {file_path}: {e}")
        
        return symbols, imports, dependencies
    
    def _parse_js_ts(self, content: str, file_path: str) -> Tuple[List[SymbolInfo], List[str], List[str]]:
        """Parse JavaScript/TypeScript file to extract symbols, imports and dependencies"""
        symbols = []
        imports = []
        dependencies = []
        
        # Simple regex-based parsing (for a more robust solution, use a proper JS/TS parser)
        try:
            # Find imports
            import_regex = r'import\s+(?:{[^}]*}|[^{}\n;]+)\s+from\s+[\'"]([^\'"]+)[\'"];?'
            require_regex = r'(?:const|let|var)\s+(?:{[^}]*}|[^{}\n;]+)\s+=\s+require\s*\(\s*[\'"]([^\'"]+)[\'"]\s*\);?'
            
            for match in re.finditer(import_regex, content):
                module = match.group(1)
                imports.append(module)
                dependencies.append(module)
                
            for match in re.finditer(require_regex, content):
                module = match.group(1)
                imports.append(module)
                dependencies.append(module)
            
            # Find classes
            class_regex = r'(?:export\s+)?class\s+(\w+)'
            for match in re.finditer(class_regex, content):
                class_name = match.group(1)
                line_start = content[:match.start()].count('\n') + 1
                
                # Find class end (naive approach)
                class_block = self._find_code_block(content, match.end())
                line_end = line_start + class_block.count('\n')
                
                symbols.append(SymbolInfo(
                    name=class_name,
                    type="class",
                    file_path=file_path,
                    line_start=line_start,
                    line_end=line_end,
                    code=f"class {class_name} {class_block}"
                ))
            
            # Find functions/methods
            function_regex = r'(?:export\s+)?(?:async\s+)?function\s+(\w+)'
            for match in re.finditer(function_regex, content):
                func_name = match.group(1)
                line_start = content[:match.start()].count('\n') + 1
                
                # Find function end and signature
                signature_end = content.find(')', match.end()) + 1
                signature = content[match.start():signature_end]
                
                func_block = self._find_code_block(content, signature_end)
                line_end = line_start + func_block.count('\n')
                
                symbols.append(SymbolInfo(
                    name=func_name,
                    type="function",
                    file_path=file_path,
                    line_start=line_start,
                    line_end=line_end,
                    signature=signature,
                    code=f"{signature} {func_block}"
                ))
            
            # Find arrow functions with assignment
            arrow_regex = r'(?:const|let|var)\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=>\n]*)\s*=>'
            for match in re.finditer(arrow_regex, content):
                func_name = match.group(1)
                line_start = content[:match.start()].count('\n') + 1
                
                # Find signature end
                arrow_pos = content.find('=>', match.end())
                signature = content[match.start():arrow_pos+2]
                
                func_block = self._find_code_block(content, arrow_pos+2)
                line_end = line_start + func_block.count('\n')
                
                symbols.append(SymbolInfo(
                    name=func_name,
                    type="function",
                    file_path=file_path,
                    line_start=line_start,
                    line_end=line_end,
                    signature=signature,
                    code=f"{signature} {func_block}"
                ))
                
        except Exception as e:
            logger.error(f"Error parsing JS/TS file {file_path}: {e}")
        
        return symbols, imports, dependencies
    
    def _find_end_line(self, content: str, node) -> int:
        """Find the end line of a Python AST node"""
        if hasattr(node, 'end_lineno'):
            return node.end_lineno
        
        # For older Python versions without end_lineno
        try:
            # Get source segment
            source_lines = content.splitlines()
            line_start = node.lineno
            last_line = len(source_lines)
            
            # Simple indentation-based detection
            node_indent = len(source_lines[line_start-1]) - len(source_lines[line_start-1].lstrip())
            
            # Find the next line with same or less indentation
            for i in range(line_start, last_line):
                line = source_lines[i]
                if line.strip() and len(line) - len(line.lstrip()) <= node_indent:
                    return i
            
            return last_line
        except:
            # Fallback: assume node ends on the same line
            return node.lineno
    
    def _find_code_block(self, content: str, start_pos: int) -> str:
        """Find a complete code block starting at the given position"""
        # Find opening brace
        brace_pos = content.find('{', start_pos)
        if brace_pos == -1:
            # No block found, might be a one-line expression
            semicolon_pos = content.find(';', start_pos)
            if semicolon_pos == -1:
                # Return rest of content
                return content[start_pos:]
            return content[start_pos:semicolon_pos+1]
        
        # Count braces to find matching closing brace
        brace_count = 1
        pos = brace_pos + 1
        
        while pos < len(content) and brace_count > 0:
            if content[pos] == '{':
                brace_count += 1
            elif content[pos] == '}':
                brace_count -= 1
            pos += 1
        
        return content[brace_pos:pos]
    
    def search_symbols(self, query: str, symbol_type: Optional[str] = None, 
                      language: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Search for symbols in the codebase
        
        Args:
            query: Search query (supports SQL LIKE patterns with % and _)
            symbol_type: Optional filter by symbol type (class, function, method, etc.)
            language: Optional filter by language
            limit: Maximum number of results to return
            
        Returns:
            List of matching symbols
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            # Build query
            sql = '''
            SELECT s.*, f.path, f.language
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.name LIKE ?
            '''
            params = [f'%{query}%']
            
            if symbol_type:
                sql += ' AND s.type = ?'
                params.append(symbol_type)
                
            if language:
                sql += ' AND f.language = ?'
                params.append(language)
                
            sql += ' ORDER BY s.name LIMIT ?'
            params.append(limit)
            
            cursor.execute(sql, params)
            
            # Convert to list of dictionaries
            columns = [col[0] for col in cursor.description]
            results = []
            
            for row in cursor.fetchall():
                result = dict(zip(columns, row))
                results.append(result)
                
            return results
            
        except sqlite3.Error as e:
            logger.error(f"Error searching symbols: {e}")
            return []
    
    def find_references(self, symbol_name: str, file_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Find references to a symbol across the codebase
        
        Args:
            symbol_name: Name of the symbol to find references to
            file_path: Optional filter by file path
            
        Returns:
            List of references
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            # Build query
            sql = '''
            SELECT s.name, s.type, f.path, s.line_start, s.line_end
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE s.name = ?
            '''
            params = [symbol_name]
            
            if file_path:
                sql += ' AND f.path = ?'
                params.append(file_path)
                
            cursor.execute(sql, params)
            
            # Convert to list of dictionaries
            columns = [col[0] for col in cursor.description]
            results = []
            
            for row in cursor.fetchall():
                result = dict(zip(columns, row))
                results.append(result)
                
            return results
            
        except sqlite3.Error as e:
            logger.error(f"Error finding references: {e}")
            return []
    
    def get_dependencies(self, file_path: str) -> List[str]:
        """
        Get dependencies of a file
        
        Args:
            file_path: Path of the file
            
        Returns:
            List of dependencies
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            cursor.execute('''
            SELECT d.target
            FROM dependencies d
            JOIN files f ON d.source_file_id = f.id
            WHERE f.path = ?
            ''', (file_path,))
            
            return [row[0] for row in cursor.fetchall()]
            
        except sqlite3.Error as e:
            logger.error(f"Error getting dependencies: {e}")
            return []
    
    def get_dependents(self, module_name: str) -> List[str]:
        """
        Get files that depend on a module
        
        Args:
            module_name: Name of the module
            
        Returns:
            List of dependent file paths
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            cursor.execute('''
            SELECT f.path
            FROM dependencies d
            JOIN files f ON d.source_file_id = f.id
            WHERE d.target LIKE ?
            ''', (f'%{module_name}%',))
            
            return [row[0] for row in cursor.fetchall()]
            
        except sqlite3.Error as e:
            logger.error(f"Error getting dependents: {e}")
            return []
    
    def get_file_symbols(self, file_path: str) -> List[Dict[str, Any]]:
        """
        Get all symbols defined in a file
        
        Args:
            file_path: Path of the file
            
        Returns:
            List of symbols
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            cursor.execute('''
            SELECT s.*
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE f.path = ?
            ORDER BY s.line_start
            ''', (file_path,))
            
            # Convert to list of dictionaries
            columns = [col[0] for col in cursor.description]
            results = []
            
            for row in cursor.fetchall():
                result = dict(zip(columns, row))
                results.append(result)
                
            return results
            
        except sqlite3.Error as e:
            logger.error(f"Error getting file symbols: {e}")
            return []
    
    def get_symbol_by_location(self, file_path: str, line: int) -> Optional[Dict[str, Any]]:
        """
        Get the symbol at a specific location in a file
        
        Args:
            file_path: Path of the file
            line: Line number
            
        Returns:
            Symbol info or None if not found
        """
        try:
            # Ensure we're using the main thread connection for queries
            cursor = self.conn.cursor()
            
            cursor.execute('''
            SELECT s.*
            FROM symbols s
            JOIN files f ON s.file_id = f.id
            WHERE f.path = ? AND s.line_start <= ? AND s.line_end >= ?
            ORDER BY (s.line_end - s.line_start) ASC
            LIMIT 1
            ''', (file_path, line, line))
            
            row = cursor.fetchone()
            if row:
                columns = [col[0] for col in cursor.description]
                return dict(zip(columns, row))
            
            return None
            
        except sqlite3.Error as e:
            logger.error(f"Error getting symbol by location: {e}")
            return None
    
    def get_index_status(self) -> Dict[str, Any]:
        """Get the current status of the index"""
        # Update file and symbol count from database to ensure accuracy
        try:
            # Use thread-local connection
            if not hasattr(self._thread_local, 'conn'):
                self._thread_local.conn = sqlite3.connect(self.db_path)
                
            cursor = self._thread_local.conn.cursor()
            
            # Get file count
            cursor.execute('SELECT COUNT(*) FROM files')
            row = cursor.fetchone()
            if row:
                self.file_count = row[0]
                
            # Get symbol count
            cursor.execute('SELECT COUNT(*) FROM symbols')
            row = cursor.fetchone()
            if row:
                self.symbol_count = row[0]
                
            # Get last indexed timestamp
            cursor.execute('SELECT value FROM metadata WHERE key = ?', ('last_indexed',))
            row = cursor.fetchone()
            if row:
                try:
                    self.last_indexed = float(row[0])
                except (ValueError, TypeError):
                    pass
        except sqlite3.Error as e:
            logger.error(f"Error getting index status: {e}")
            
        return {
            "last_indexed": self.last_indexed,
            "file_count": self.file_count,
            "symbol_count": self.symbol_count,
            "indexing_in_progress": self.indexing_in_progress,
        }
    
    def clear_index(self) -> bool:
        """Clear the entire index"""
        try:
            with self.index_lock:
                if self.indexing_in_progress:
                    logger.warning("Cannot clear index while indexing is in progress")
                    return False
                
                # Ensure we're using the main thread connection for clearing
                cursor = self.conn.cursor()
                cursor.execute('DELETE FROM symbol_references')
                cursor.execute('DELETE FROM dependencies')
                cursor.execute('DELETE FROM symbols')
                cursor.execute('DELETE FROM files')
                cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', ('0', 'last_indexed'))
                cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', ('0', 'file_count'))
                cursor.execute('UPDATE metadata SET value = ? WHERE key = ?', ('0', 'symbol_count'))
                self.conn.commit()
                
                self.last_indexed = 0
                self.file_count = 0
                self.symbol_count = 0
                
                logger.info("Codebase index cleared")
                return True
                
        except sqlite3.Error as e:
            logger.error(f"Error clearing index: {e}")
            return False
    
    def close(self):
        """Close the database connection"""
        # Close main connection
        if self.conn:
            self.conn.close()
            self.conn = None
            
        # Close any thread-local connections
        if hasattr(self._thread_local, 'conn'):
            self._thread_local.conn.close()
            delattr(self._thread_local, 'conn')