# Repository reader tools

The package currently exposes three read-only repository tools:

- `listFiles` returns sorted workspace-relative file paths.
- `readFile` returns a bounded UTF-8 excerpt for one file.
- `searchCode` performs a case-insensitive literal search and returns line excerpts.

Create a `Workspace` with `openWorkspace` using a trusted root selected by the application. Tool inputs are parsed at runtime; unknown fields, absolute paths, parent traversal, symlink paths outside the root, environment files, and generated or dependency directories are rejected or skipped.

The tools cap recursion depth, result counts, individual file reads, total search bytes, and match counts. They do not execute repository code or write files. File modification and command execution will be added as separate, permission-checked capabilities.
