# Kanban Board Export (powered by Backlog.md)
Generated on: 2026-06-03 03:35:52
Project: Gateway Live Access

| To Do | In Progress | Done |
| --- | --- | --- |
| **GLA-003** - Scaffold the modular-monolith skeleton and quality gate<br>*#foundation #impl* |  |  |
| **GLA-001** - Plan the GLA system-architecture baseline<br>*#foundation #plan* |  |  |
| **GLA-002** - Plan the shared kernel and cross-module contracts<br>*#foundation #plan* |  |  |
| **GLA-004** - Implement the shared kernel and contracts<br>*#foundation #impl* |  |  |
| **GLA-005** - Plan the dependency and ownership strategy<br>*#foundation #dependency #plan* |  |  |
| **GLA-006** - Integrate the Cedar policy engine<br>*#dependency #trad #impl* |  |  |
| **GLA-007** - Build a wpm installer package for the browser runtime<br>*#dependency #wpm #impl* |  |  |
| **GLA-008** - Build a wpm installer package for the human-view stack<br>*#dependency #wpm #impl* |  |  |
| **GLA-009** - Build a wpm installer package for the capsule isolation runtime<br>*#dependency #wpm #impl* |  |  |
| **GLA-010** - Build a wpm installer package for the edge proxy<br>*#dependency #wpm #impl* |  |  |
| **GLA-011** - Build a wpm installer package for the identity provider<br>*#dependency #wpm #impl* |  |  |
| **GLA-012** - Plan the recipient-enrollment step<br>*#plan #architecture #row #enrollment* |  |  |
| **GLA-013** - Enroll a recipient so they can later be verified<br>*#impl #row #enrollment* |  |  |
| **GLA-014** - Plan the inbound-request and agent-connect step<br>*#plan #architecture #row #inbound* |  |  |
| **GLA-015** - Receive a request and connect the agent<br>*#impl #row #inbound* |  |  |
| **GLA-016** - Plan the agent-orientation step<br>*#plan #architecture #row #orient* |  |  |
| **GLA-017** - Orient the agent against the install<br>*#impl #row #orient* |  |  |
| **GLA-018** - Plan the propose-task-and-session step<br>*#plan #architecture #row #propose* |  |  |
| **GLA-019** - Open a task and submit a session proposal<br>*#impl #row #propose* |  |  |
| **GLA-020** - Plan the admit-the-proposal step<br>*#plan #architecture #row #admit* |  |  |
| **GLA-021** - Admit a session proposal<br>*#impl #row #admit* |  |  |
| **GLA-022** - Plan the provision-the-capsule step<br>*#plan #architecture #row #provision* |  |  |
| **GLA-023** - Provision the live capsule<br>*#impl #row #provision* |  |  |
| **GLA-024** - Plan the agent-connector step<br>*#plan #architecture #row #connector* |  |  |
| **GLA-025** - Return an agent-blind connector to the agent<br>*#impl #row #connector* |  |  |
| **GLA-026** - Plan the agent-drives-via-connector step<br>*#plan #architecture #row #drive* |  |  |
| **GLA-027** - Drive the capsule autonomously over the connector<br>*#impl #row #drive* |  |  |
| **GLA-028** - Plan any change for the second autonomous-drive pass<br>*#plan #check #row #drive* |  |  |
| **GLA-029** - Drive the capsule to a second page without rebuilding<br>*#impl #check #row #drive* |  |  |
| **GLA-030** - Plan any change for driving while the session stays active<br>*#plan #check #row #drive* |  |  |
| **GLA-031** - Resume driving on an active session without rebuilding<br>*#impl #check #row #drive* |  |  |
| **GLA-032** - Plan the open-a-recipient-bound-window step<br>*#plan #architecture #row #handoff* |  |  |
| **GLA-033** - Open a recipient-bound handoff window onto the capsule<br>*#impl #row #handoff* |  |  |
| **GLA-034** - Plan the user-authenticates-at-the-edge step<br>*#plan #architecture #row #auth* |  |  |
| **GLA-035** - Verify the bound recipient at the edge<br>*#impl #row #auth* |  |  |
| **GLA-036** - Plan any change for returning the auth result to the gateway<br>*#plan #check #row #auth* |  |  |
| **GLA-037** - Return the verification result to the gateway without rebuilding<br>*#impl #check #row #auth* |  |  |
| **GLA-038** - Plan the verified-human-reaches-the-capsule step<br>*#plan #architecture #row #reach* |  |  |
| **GLA-039** - Let the verified human reach the capsule surface<br>*#impl #row #reach* |  |  |
| **GLA-040** - Plan the user-works-in-window-agent-blind step<br>*#plan #architecture #row #fill* |  |  |
| **GLA-041** - Let the human work in-window without the agent seeing secrets<br>*#impl #row #fill* |  |  |
| **GLA-042** - Plan the detect-completion step<br>*#plan #architecture #row #detect* |  |  |
| **GLA-043** - Detect completion of the human step<br>*#impl #row #detect* |  |  |
| **GLA-044** - Plan the close-the-window-and-resume step<br>*#plan #architecture #row #close* |  |  |
| **GLA-045** - Close the window and let the agent resume<br>*#impl #row #close* |  |  |
| **GLA-046** - Plan any change for the agent inspecting after the first window<br>*#plan #check #row #drive* |  |  |
| **GLA-047** - Inspect after the first window without rebuilding<br>*#impl #check #row #drive* |  |  |
| **GLA-048** - Plan the re-open-onto-the-same-capsule delta<br>*#plan #check #row #handoff* |  |  |
| **GLA-049** - Re-open a window onto the same capsule without rebuilding<br>*#impl #check #row #handoff* |  |  |
| **GLA-050** - Plan the auth-reused-on-re-open delta<br>*#plan #check #row #auth* |  |  |
| **GLA-051** - Reuse valid authentication on the second window without rebuilding<br>*#impl #check #row #auth* |  |  |
| **GLA-052** - Plan any change for reaching the capsule on the reused-auth window<br>*#plan #check #row #reach* |  |  |
| **GLA-053** - Reach the capsule on the reused-auth window without rebuilding<br>*#impl #check #row #reach* |  |  |
| **GLA-054** - Plan any change for the human entering the verification code<br>*#plan #check #row #fill* |  |  |
| **GLA-055** - Let the human enter the code agent-blind without rebuilding<br>*#impl #check #row #fill* |  |  |
| **GLA-056** - Plan any change for detecting the second completion<br>*#plan #check #row #detect* |  |  |
| **GLA-057** - Detect the second completion without rebuilding<br>*#impl #check #row #detect* |  |  |
| **GLA-058** - Plan any change for closing the second window<br>*#plan #check #row #close* |  |  |
| **GLA-059** - Close the second window without rebuilding<br>*#impl #check #row #close* |  |  |
| **GLA-060** - Plan any change for the agent configuring the account<br>*#plan #check #row #drive* |  |  |
| **GLA-061** - Configure the account over the connector without rebuilding<br>*#impl #check #row #drive* |  |  |
| **GLA-062** - Plan any change for resuming after configuration<br>*#plan #check #row #drive* |  |  |
| **GLA-063** - Keep the session active through configuration without rebuilding<br>*#impl #check #row #drive* |  |  |
| **GLA-064** - Plan the tear-down-the-session step<br>*#plan #architecture #row #teardown* |  |  |
| **GLA-065** - Tear down the session and revoke everything<br>*#impl #row #teardown* |  |  |
| **GLA-066** - Pass the scenario-01 through-case end to end<br>*#e2e #impl* |  |  |
