#!/usr/bin/env node
/**
 * `miyagi-observe`: the editor hook.
 *
 * A separate entry point from the server because it runs after every tool call
 * an assistant makes. Loading the MCP SDK and the whole tool surface to append
 * one line would add a visible pause to each of them. This file loads the
 * observation module and nothing else, and it always exits 0.
 */

import { runObserveHook } from "./observe.js";

runObserveHook()
  .catch(() => 0)
  .finally(() => process.exit(0));
