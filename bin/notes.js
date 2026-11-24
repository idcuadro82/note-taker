#!/usr/bin/env node
try {
  // Imported here so that errors while loading (e.g. a bad config file)
  // are reported as a message instead of a stack trace.
  const { main } = await import("../src/cli.ts");
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
