# Third-party components and licensing

The repository's original application code does not currently declare an overall open-source license. Publishing this snapshot does not add a new license grant. Ask the repository owner about licensing requirements before redistributing original application code beyond applicable permissions.

The vendored shadcn/ui component files in `src/components/ui/` retain their MIT notice in `src/components/ui/LICENSE.md`.

Build and runtime dependencies are resolved from the public npm registry by the committed `package-lock.json`. Their individual license identifiers and exact versions are recorded there. Dependency source/binaries and `node_modules` are not vendored. Retain required notices when distributing a bundled build. Notable direct dependencies include React, React DOM, Radix UI, Lucide React, Tailwind CSS, Vite, TypeScript, Drizzle, JSDOM, and their utility packages.

No proprietary ChatGPT Sites, identity-provider, scheduler, or Discord service implementation is included. References to external platform protocols, header names, and configuration bindings describe integration requirements, not ownership of those services.
