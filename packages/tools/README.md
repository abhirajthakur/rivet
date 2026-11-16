# Repository reader tools

The package currently exposes three read-only repository tools:

- `listFiles` returns sorted workspace-relative file paths.
- `readFile` returns a bounded UTF-8 excerpt for one file.
- `searchCode` performs a case-insensitive literal search and returns line excerpts.

Create a `Workspace` with `openWorkspace` using a trusted root selected by the application. Tool inputs are parsed at runtime; unknown fields, absolute paths, parent traversal, symlink paths outside the root, environment files, and generated or dependency directories are rejected or skipped.

The read tools cap recursion depth, result counts, individual file reads, total search bytes, and match counts. Repository inspection and editing tools do not execute repository code. Editing is exposed through separate, permission-checked operations.

`writeFile` can create a new text file or replace an existing file when the caller supplies its current SHA-256 digest. `applyPatch` applies exact text replacements only when every search string has exactly one match and the supplied digest still matches. Both operations use atomic replacement, reject paths outside the workspace and sensitive paths, and cap edited file size at 1 MiB. They do not create missing parent directories.
