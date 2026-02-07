# Framework Extraction Notes

## Image 1: Intent & Steering
- **Concept:** "Start with Intent" -> drives "Steering" -> requires "Context".
- **Key Relationship:** Intent determines the necessary context (technical/domain knowledge).
- **Mechanism:**
    - "Steering Documents" align with Intent.
    - "Context" is dynamically managed.
    - **MCP (Model Context Protocol)** servers are the bridge for external tools/data.
- **UI Element:** Shows an interface for "Agent Steering" with options to "Generate Steering Docs" and connect "MCP Servers".
- **Source:** Looks like an AWS presentation ("Bonnie's (uk-lon-bon)").

## Framework Draft
1. **Intent Definition:** What is the agent trying to do?
2. **Context Assembly:** What domain knowledge does it need? (Dynamic)
3. **Steering Alignment:** Create documents that guide behavior to match intent.
4. **Tooling/Connectivity:** Use MCP servers to bridge the agent to the context.
