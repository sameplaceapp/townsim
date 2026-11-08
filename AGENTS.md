# Willowbrook — Codex Development Instructions

## Project Overview

Willowbrook is a persistent, autonomous, pixel-art civilization simulator based on the open-source TownSim project.

The project owner directs features, reviews changes, and manually tests the application. Codex is responsible for implementation, debugging, automated testing, and preparing GitHub pull requests.

Prioritize maintainability, low resource consumption, and incremental development.

## 1. Mandatory Git Workflow

For every approved implementation task, follow this workflow:

1. Start from the latest approved `main` branch of the project owner's GitHub fork.
2. Create a dedicated feature branch before modifying application code. If the Codex environment already provides an isolated task branch, use that branch instead of creating an unnecessary duplicate.
3. Use descriptive branch names, such as:
   - `feature/world-history`
   - `feature/character-aging`
   - `fix/shutdown-persistence`
   - `feature/family-trees`
4. Implement only the requested feature or fix.
5. Run relevant automated tests and address failures introduced by the changes.
6. Commit the completed changes to the feature branch with a descriptive commit message.
7. Publish or push the feature branch to the project owner's GitHub fork using the available GitHub integration.
8. Create a GitHub pull request with the feature branch as the source and the fork's `main` branch as the target.
9. Mark the work ready for the project owner's manual testing.
10. Stop and wait for the project owner to test and manually merge the pull request.

**Never commit feature changes directly to `main`. Never automatically merge a pull request. Never automatically begin the next feature.**

Do not create pull requests against the original upstream TownSim repository.

If the Codex environment does not permit pushing branches or creating pull requests, use the platform's available publishing workflow. If publication still cannot be completed, clearly report the limitation and the exact manual action required.

Do not claim that work has been published unless it is actually visible on GitHub.

## 2. Feature Development Rules

- Work on one approved feature or milestone at a time.
- Prefer extending existing functionality over rewriting working systems.
- Avoid unrelated refactoring and unnecessary dependencies.
- Preserve existing features unless modifications are explicitly required.
- Use the existing architecture and coding conventions where practical.
- For significant architectural changes, explain the approach and obtain approval before implementation.
- Do not introduce paid services or additional infrastructure without approval.
- Do not modify these development instructions without the project owner's approval.

For assessment-only or planning-only requests, do not modify code, create implementation branches, or publish changes unless explicitly requested.

## 3. Testing Requirements

Before creating a pull request:

- Run the existing relevant automated tests.
- Add or update tests for new functionality where appropriate.
- Confirm existing functionality has not regressed.
- Test browser-facing features using the available browser-testing tools when practical.
- Test backend functionality independently of the browser where appropriate.
- Explicitly report any tests that could not be completed.

Every pull request must contain a **Manual Testing Instructions** section explaining:

1. How to run the modified application.
2. What the project owner should observe.
3. How to trigger the new functionality.
4. How to determine whether the feature works correctly.
5. Any known limitations or unresolved issues.

Provide exact commands when necessary, based on the actual repository configuration.

Automated tests passing does not replace manual acceptance testing.

## 4. Pull Request Requirements

Every pull request must include:

- **Summary:** What was implemented, explained in plain English.
- **Changes:** The main files or systems affected.
- **Testing:** Automated tests executed and their results.
- **Manual Testing Instructions:** Steps the project owner can independently reproduce.
- **Risks or Limitations:** Known problems, compatibility concerns, or incomplete work.

When finished, provide the project owner with:

- Feature branch name.
- Commit identifier.
- GitHub pull request URL.
- Automated test results.
- Confirmation that the PR is ready for manual testing.

Do not mark a feature complete merely because code was written. The development handoff is complete when the changes are published for review and testing, or a specific publication blocker is reported.

## 5. Approval and Merge Policy

The project owner has final authority over all merges and deployments.

Codex must never:

- Merge a pull request without explicit authorization.
- Push feature changes directly to `main`.
- Deploy to production without authorization.
- Delete persistent simulation data without authorization.
- Begin the next development milestone before approval.

If manual testing reveals a problem, fix it on the same feature branch and update the existing pull request.

Once the project owner merges the pull request, the next approved feature must begin from the updated `main` branch.

## 6. Hosting and Resource Constraints

The production environment is:

- Raspberry Pi 5 with 4GB RAM.
- Headless DietPi.
- Linux ARM64.
- Docker-based deployment.
- Shared hardware with other existing services.

Requirements:

- Production must run entirely within Docker.
- The simulation must continue without an active browser.
- World state must survive container restarts.
- Resource consumption must be controlled.
- External LLM integration must remain optional.
- Rule-based simulation must work without paid API access.
- Do not expose services publicly or add port forwarding.
- Preserve private LAN and Tailscale access.
- Do not modify unrelated Docker services or host configuration.

Development and automated tests may run outside Docker. Production deployment must respect the Docker requirements.

## 7. Communication Standards

The project owner is technically experienced in systems administration but does not intend to perform day-to-day software development.

Explain changes using clear technical language without assuming deep familiarity with the codebase.

When reporting completion, focus on:

- What changed.
- Why it changed.
- Whether it passed testing.
- How to independently verify it.
- What requires approval next.

**The default stopping point for every feature is an open GitHub pull request awaiting the project owner's manual testing and merge approval.**
