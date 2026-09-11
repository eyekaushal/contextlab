/**
 * contextlab CLI.
 *
 * Thin by design: argv in, a call into core or store, formatted output. No
 * analysis lives here.
 *
 * @module
 */

import { TOOLS } from '@contextlab/core'
import { Command } from 'commander'
import { cost } from './commands/cost.js'
import { dashboard } from './commands/dashboard.js'
import { doctor } from './commands/doctor.js'
import { launch } from './commands/launch.js'
import { optimize } from './commands/optimize.js'
import { watch } from './commands/watch.js'
import { why } from './commands/why.js'

const VERSION = '0.1.0'

/**
 * @param {string[]} argv
 * @returns {void}
 */
export function run(argv) {
  const program = new Command()

  program
    .name('contextlab')
    .description(
      'See what is actually filling your AI coding agent context window,\n' +
        'what it costs, and what to change to fix it.',
    )
    .version(VERSION)
    .addHelpText(
      'after',
      `\nRun an agent through the proxy:\n` +
        `  $ contextlab claude\n` +
        `  $ contextlab codex\n` +
        `  $ contextlab -- python my_agent.py\n\n` +
        `Supported out of the box: ${Object.keys(TOOLS).join(', ')}\n`,
    )

  program
    .command('watch')
    .description('live context gauge in the terminal')
    .action(() => {
      void watch()
    })

  program
    .command('cost')
    .description('historical spend, by day or project')
    .option('--by <dimension>', 'day or project', 'day')
    .option('--days <n>', 'how many days to show', '14')
    .option('--project <path>', 'limit to one project')
    .option('--json', 'machine-readable output')
    .action((options) => cost(options))

  program
    .command('why')
    .description('why was my last turn expensive?')
    .option('--session <id>', 'a specific session instead of the latest')
    .option('--json', 'machine-readable output')
    .action((options) => why(options))

  program
    .command('optimize')
    .description('ranked waste, and the exact change to make')
    .option('--session <id>', 'a specific session instead of the latest')
    .option('--all', 'every recent session, not just the latest')
    .option('--json', 'machine-readable output')
    .action((options) => optimize(options))

  program
    .command('dashboard')
    .description('serve the dashboard and open it in a browser')
    .option('--port <n>', 'server port', '4041')
    .option('--no-open', 'do not open a browser')
    .action(async (options) => {
      await dashboard(options)
    })

  program
    .command('doctor')
    .description('check that everything is ready')
    .option('--json', 'machine-readable output')
    .action(async (options) => {
      process.exitCode = await doctor(options)
    })

  // Anything that is not one of the five commands is a tool to launch, so
  // `contextlab claude` works without a `run` subcommand in front of it.
  program
    .argument('[tool]', 'coding agent to run through the proxy')
    .argument('[args...]', 'arguments passed straight to the tool')
    .option('--port <n>', 'proxy port', '4040')
    .action(async (tool, args, options) => {
      if (!tool) {
        program.help()
        return
      }
      process.exitCode = await launch(tool, args ?? [], options)
    })

  program.parseAsync(argv).catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
}
