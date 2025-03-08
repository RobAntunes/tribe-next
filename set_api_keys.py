#!/usr/bin/env python3

import os
import sys
import json
import getpass

def save_api_keys(anthropic_key, openai_key, save_to_env_file=False):
    """Save API keys to environment or .env file"""
    # Set keys in current session
    if anthropic_key:
        os.environ["ANTHROPIC_API_KEY"] = anthropic_key
        print("✅ Set ANTHROPIC_API_KEY in current session")
    
    if openai_key:
        os.environ["OPENAI_API_KEY"] = openai_key
        print("✅ Set OPENAI_API_KEY in current session")
    
    # Save to .env file if requested
    if save_to_env_file:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        env_content = []
        
        if anthropic_key:
            env_content.append(f'ANTHROPIC_API_KEY="{anthropic_key}"')
        
        if openai_key:
            env_content.append(f'OPENAI_API_KEY="{openai_key}"')
        
        with open(env_path, "w") as f:
            f.write("\n".join(env_content))
        
        print(f"✅ Saved API keys to {env_path}")
    
    # Save to VSCode settings file
    vscode_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".vscode")
    os.makedirs(vscode_dir, exist_ok=True)
    
    settings_path = os.path.join(vscode_dir, "settings.json")
    
    try:
        if os.path.exists(settings_path):
            with open(settings_path, "r") as f:
                settings = json.load(f)
        else:
            settings = {}
        
        if anthropic_key:
            settings["mightydev.anthropicApiKey"] = anthropic_key
        
        if openai_key:
            settings["mightydev.openaiApiKey"] = openai_key
        
        with open(settings_path, "w") as f:
            json.dump(settings, f, indent=2)
        
        print(f"✅ Saved API keys to VS Code settings")
    except Exception as e:
        print(f"❌ Failed to save to VS Code settings: {e}")

def main():
    print("MightyDev API Key Setup")
    print("======================")
    
    # Ask for API keys
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    
    if anthropic_key:
        print(f"Current ANTHROPIC_API_KEY: {'*' * (len(anthropic_key) - 4) + anthropic_key[-4:]}")
        change = input("Change Anthropic API key? [y/N]: ").lower()
        if change == 'y':
            anthropic_key = getpass.getpass("Enter Anthropic API key (claude-xxx...): ")
    else:
        anthropic_key = getpass.getpass("Enter Anthropic API key (claude-xxx...): ")
    
    if openai_key:
        print(f"Current OPENAI_API_KEY: {'*' * (len(openai_key) - 4) + openai_key[-4:]}")
        change = input("Change OpenAI API key? [y/N]: ").lower()
        if change == 'y':
            openai_key = getpass.getpass("Enter OpenAI API key (sk-xxx...): ")
    else:
        openai_key = getpass.getpass("Enter OpenAI API key (sk-xxx...): ")
    
    # Ask if keys should be saved to .env file
    save_to_env = input("Save keys to .env file? [y/N]: ").lower() == 'y'
    
    # Save the keys
    save_api_keys(anthropic_key, openai_key, save_to_env)
    
    print("\n✅ API key setup complete!")
    return 0

if __name__ == "__main__":
    sys.exit(main())