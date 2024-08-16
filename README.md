# Ndepe

`Ndepe` is a utility that analyzes your Node.js project's source code to extract the necessary dependencies and files required for deployment and emits these files to a designed node_modules directory that can be used for the deployment. `Ndepe` can simplify the deployment flow and greatly reduce the size of the deployment package.


## Features

- **Efficient File Extraction and Size Reduction**: Automatically detects and extracts only the files required by your project,generate to designed, production-ready node_modules directory, significantly reducing deployment package size. It can be used with some popular Node.js frameworks such as Express, Koa and NestJS e.g..
- **Monorepo Tool Agnostic**: Compatible with any monorepo tool (e.g., pnpm, Rush, Nx, Turborepo) and offers faster deployment compared to deployment capability of monorepo tools.
- **Rich Configuration and Extensibility**: Supports customizable file inclusion rules, cache configuration, and other extensible options to meet diverse project needs.

## Usage

```
import { nodeDepEmit } from 'ndepe'

nodeDepEmit({
  appDir: appDirectory,
  serverRootDir: outputDirectory,
})

```

