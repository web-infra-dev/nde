# Nde (Node.js Dependencies Extractor)

`nde` is a utility that analyzes your Node.js project's source code to extract only the necessary dependencies and files required for deployment. By emitting these essential files to a new directory, nde simplifies the deployment process and significantly reduces the deployment package size.

## Features

- **Efficient File Extraction and Size Reduction**: Automatically detects and extracts only the files required by your project,generate well-designed, production-ready node_modules directory, significantly reducing deployment package size. It can be used with some popular Node.js frameworks such as Express, Koa and NestJS e.g..
- **Monorepo Tool Agnostic**: Compatible with any monorepo tool (e.g., pnpm, Rush, Nx, Turborepo) and offers faster deployment compared to deployment capability of monorepo tools.
- **Rich Configuration and Extensibility**: Supports customizable file inclusion rules, cache configuration, and other extensible options to meet diverse project needs.

## Usage

```
import { handleDependencies } from 'nde'

handleDependencies({
  appDir: appDirectory,
  serverRootDir: outputDirectory,
})

```

