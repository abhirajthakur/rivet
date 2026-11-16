# Docker command sandbox

`DockerSandboxRunner` runs an argv command in a task workspace mounted at `/workspace`. It does not invoke a host shell and does not forward application environment variables into the container.

Each container has networking disabled, a read-only root filesystem, a non-root UID, all Linux capabilities dropped, `no-new-privileges`, and limits for CPU, memory, process count, file size, command duration, and captured output. The task workspace is the only writable host mount. Use a disposable per-task workspace, not the developer's primary checkout.

Build the local image once:

```sh
docker build -f infra/docker/sandbox.Dockerfile -t rivet-sandbox:node24 .
```

The runner uses `--pull=never`; image pulls happen only during this explicit image build. Keep repository credentials and model-provider keys outside the workspace and container. For stronger host isolation, use rootless Docker or Docker Desktop's WSL virtual machine. Docker cgroup limits must be supported by the daemon for resource caps to take effect.
