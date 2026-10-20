# Runner launch preparation

Core selects the provider, model, instructions, tools, and task permissions.
The execution environment supplies executable paths and filesystem locations.

The built-in TypeScript implementation constructs the provider descriptor in
`createRunnerProviderLaunch`. The transport sends this descriptor with
`run.prepare`. Provider backends keep their existing validation and session rules.

This separation does not change file preparation. The SDK still prepares local
files and stages remote files through the existing execution driver.
It does not enable plugin-owned launch preparation.
