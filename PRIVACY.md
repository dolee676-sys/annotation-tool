# Privacy Policy

**Project:** Zhujie Annotation (注解)  
**Last updated:** 2026-11-06

Zhujie Annotation is a local-first Windows desktop application for explaining selected text and answering questions about it.

## Data stored on your computer

The app stores the following data locally in its user data folder (`%APPDATA%\zhujie` by default):

- settings and model/provider configuration
- API keys, encrypted with Windows `safeStorage` when available
- history, follow-up conversations, favorites, usage records, and compressed summaries

History and summaries are plain-text files and are not additionally encrypted. If several people use the same Windows account, protect the user data folder accordingly.

The project does not operate a developer account system, telemetry, analytics, crash reporting, or cloud sync.

## Network requests

- **Local mode:** the app connects only to a local model endpoint such as Ollama or LM Studio (`localhost` / `127.0.0.1`). Selected text does not leave the computer.
- **Cloud mode:** selected text, the surrounding context, and questions are sent to the model provider configured by the user, using the user's own API key. That provider's privacy policy and terms apply.
- **Update checks:** the app may request GitHub Releases to check for updates. Selected text and questions are not included. Downloaded update packages are verified with SHA-256.

## Data removal

- Delete individual history records or favorites in the app.
- Clear usage records in the app.
- Remove all local app data by deleting `%APPDATA%\zhujie` after quitting the app.
- Uninstalling removes the program files; the user data folder must be removed separately if desired.

## Third parties

The project does not route data through a project-operated server. Cloud model providers and GitHub are third-party services chosen or contacted by the app as described above.

## Contact

Privacy questions and reports can be opened through GitHub Issues:

https://github.com/dolee676-sys/annotation-tool/issues

## Changes

This policy may be updated as the app changes. The latest version is published in this repository.
