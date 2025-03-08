MightyDev Project Specification
Overview
MightyDev is a Python VSCode extension for building an agentic, AI-native IDE that resides in the extensions folder of a fork of VSCode. The project makes extensive and idiomatic use of the CrewAI framework to create a highly dynamic development environment with powerful AI agents. The agents can dynamically generate additional agents, tasks, tools, and assign them to teams, crews, and workflows at runtime. Most decision-making is delegated to the AI models.

The ultimate goal is to have an IDE where the human can focus on the abstract idea and vision while the AI Agents handle implementation and architecture, harmoniously with each other.

Key Architecture Notes
* CrewAI Extension: The base classes from CrewAI will need to be extended to allow for dynamic runtime creation of agents, tasks, tools, and assignments.
* Product Focus: MightyDev is a product, not a management simulator. Agent output quality is paramount. Variable properties affecting output quality (e.g., skill levels) should be avoided in favor of stylistic properties (tone, learning style, working style, communication style, quirks, traits, etc.).
* UI Integration: All development should check for existing UI components in the webview folder and adapt/enhance them rather than creating duplicates.
Implementation Phases
1. Environment Preparation
* Create a script to download and bundle Python using the VSCode extension package (VSIX)
* Target URL structure: https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${extension}/${version}/vspackage
2. Webview Integration
* Merge the webview script with the new extension template
* Create a unified build script for seamless integration
3. Getting Started Experience
* Wire up the existing getting started screen from the webview folder
* Allow it to accept a project description and pass it to the recruitment team during initialization
* Make the getting started screen mutually exclusive with all other extension screens
4. Project Persistence
* Create a .tribe folder to store basic persistence data
    * Store agent metadata and other project information
    * Use this folder as an indicator that the project has already been initialized
5. Agent Bootstrapping
* Implement hardcoded bootstrapping agents (e.g., recruitment team) that dissolve after successful team creation
* The team must create the optimal configuration for the project described in the getting started screen
* Foundation model must:
    * Break the project down into phases
    * Create the optimal team for completing phase 1
    * Ensure all necessary agent fields are properly filled
6. Agent Configuration Example
agent = Agent(
    role="Senior Data Scientist",
    goal="Analyze and interpret complex datasets to provide actionable insights",
    backstory="With over 10 years of experience in data science and machine learning, "
              "you excel at finding patterns in complex datasets.",
    llm="gpt-4",  # Default: OPENAI_MODEL_NAME or "gpt-4"
    function_calling_llm=None,  # Optional: Separate LLM for tool calling
    memory=True,  # Default: True
    verbose=False,  # Default: False
    allow_delegation=False,  # Default: False
    max_iter=20,  # Default: 20 iterations
    max_rpm=None,  # Optional: Rate limit for API calls
    max_execution_time=None,  # Optional: Maximum execution time in seconds
    max_retry_limit=2,  # Default: 2 retries on error
    allow_code_execution=False,  # Default: False
    code_execution_mode="safe",  # Default: "safe" (options: "safe", "unsafe")
    respect_context_window=True,  # Default: True
    use_system_prompt=True,  # Default: True
    tools=[SerperDevTool()],  # Optional: List of tools
    knowledge_sources=None,  # Optional: List of knowledge sources
    embedder=None,  # Optional: Custom embedder configuration
    system_template=None,  # Optional: Custom system prompt template
    prompt_template=None,  # Optional: Custom prompt template
    response_template=None,  # Optional: Custom response template
    step_callback=None,  # Optional: Callback function for monitoring
)
7. Agent Personality and Metadata
* Each agent must include character-like names (e.g., Sparks, Nova, Trinity)
* Include detailed descriptions and metadata for UI presentation and to give each agent a unique feel
* Implement stylistic properties that don't affect output quality but create distinct personalities
8. Structured Output Tools
* Create tools for models that don't support structured outputs:
    * structuredJSONOutput: Enforces a specific output schema
    * extractJSON: Validates output (checks valid JSON, correct shape, etc.)
9. Team Creation
* Create a crew using the extracted team (via CrewAI's Crew())
* Enable memory=True for team-wide memory sharing
10. Metadata Integration
* Create a metadata tool for appending context to foundation model queries
* Include "cosmetic" properties that give agents unique characteristics
* Implement context-independent sections at the bottom of each prompt:
"X is XYZ, communicates in an XYZ style, has the following quirks: xyz, xyz, xyz and it shows in their communication style which is xyz by xyz. Etc…"
11. Project Management System
* Implement a system that works internally for agents and reflects their organizational decisions
* Allow for manual user intervention and adaptation
* Include popular views (Kanban, etc.) with drag-and-drop functionality
* Provide detailed task views
* Support multiple task execution modes:
  * Synchronous
  * Asynchronous
  * Parallel
  * Concurrent
* Enable agents to self-organize using this system (delegation, assignment, grouping, subtask creation)
* Attach task information as dynamic metadata to each agent query
12. Learning System
Implement a three-part learning system that leverages CrewAI's memory capabilities:
1. External Input
    * From users
    * From other agents
2. Reflection
    * Internal processing and analysis
    * Pattern recognition from past experiences
3. Feedback
    * Runtime "fine-tuning" through performance feedback
    * Summarize learnings and append as metadata to agent prompts.
* Memories must be accessible in the UI. There needs to be manual context and memory control, the user should be able to attach context to every request about the project. If done correctly crew ai should already handle this but we MUST ensure that deep and relevant context is sent with every message. Memories should be automatic input, manual management but context needs to be controlled by the user beyond what crew does automatically.
13. Notification system
* Make a comprehensive notification system that is non intrusive but manages user awareness and allows for a human in the loop using crew ai’s native features. The agents must wait for user confirmation for impactful tasks unless the user has decided to forgo this limitation, as such the human must constantly be notified of what is going on in the system.

14. Agents Messaging
* Agents should be able to message each other and message the human, the human should be able to talk with any agent or the entire team at once, on demand. The messages must be able to support markdown and we must have some apply options for applying code blocks to the opened file or copying them, etc. If the user accepts all we must create a full diff across all the files for the user to be able to see.

15. Code editing and Diffing system
* Choose an optimized, featureful diffing algorithm and implement code generation and ai based code actions.

Enhancement and Integration
* Perform enhancements on the implemented systems
* Wire up as much UI functionality as possible
* Document proposed future enhancements and next steps
* Append project summary to CLAUDE.md

Next Steps
After completing the initial implementation, we will continue working on enhancing and extending the functionality based on user feedback and testing results.