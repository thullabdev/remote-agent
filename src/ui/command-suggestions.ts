export type CommandSuggestion = {
  name: string
  description: string
}

export const GENERAL_COMMANDS: CommandSuggestion[] = [
  { name: 'new', description: 'Start a new Session' },
  { name: 'status', description: 'Show active Sessions and pending Prompts' },
  { name: 'away', description: 'Turn on away mode' },
  { name: 'back', description: 'Turn off away mode' },
]

export function slashCommandQuery(text: string): string | null {
  return text.match(/(?:^|\s)\/([\w-]*)$/)?.[1]?.toLowerCase() ?? null
}

export function matchingCommands(query: string | null, isGeneral: boolean): CommandSuggestion[] {
  if (query === null || !isGeneral) {
    return []
  }
  return GENERAL_COMMANDS.filter(command => command.name.startsWith(query))
}

export function moveCommandSelection(index: number, count: number, direction: -1 | 1): number {
  return count === 0 ? 0 : (index + direction + count) % count
}

export function insertCommand(text: string, name: string): string {
  return text.replace(/(^|\s)\/[\w-]*$/, (_match, prefix: string) => `${prefix}/${name} `)
}
