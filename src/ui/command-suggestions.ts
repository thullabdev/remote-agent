export type CommandSuggestion = {
  /** What is inserted: a command name without its slash, a flag such as --model, or a value such as opus. */
  name: string
  description: string
  kind?: 'command' | 'flag' | 'value'
}

export const GENERAL_COMMANDS: CommandSuggestion[] = [
  { name: 'new', description: 'Start a new Session' },
  { name: 'status', description: 'Show active Sessions and pending Prompts' },
  { name: 'away', description: 'Turn on away mode' },
  { name: 'back', description: 'Turn off away mode' },
]

/** The flags /new takes, offered after a dash. */
export const NEW_FLAGS: CommandSuggestion[] = [
  { name: '--resume', description: 'Resume an earlier session from a folder', kind: 'flag' },
  { name: '--model', description: 'Choose the model for the new session', kind: 'flag' },
]

/** The model names /new --model accepts (bridge: MODEL_ALIASES, or a full claude-… id). */
export const MODEL_VALUES: CommandSuggestion[] = [
  { name: 'opus', description: 'Most capable model', kind: 'value' },
  { name: 'sonnet', description: 'Balanced for everyday work', kind: 'value' },
  { name: 'haiku', description: 'Fastest and lightest', kind: 'value' },
  { name: 'opusplan', description: 'Opus to plan, then Sonnet to carry it out', kind: 'value' },
]

export function slashCommandQuery(text: string): string | null {
  return text.match(/(?:^|\s)\/([\w-]*)$/)?.[1]?.toLowerCase() ?? null
}

export function matchingCommands(query: string | null, isGeneral: boolean): CommandSuggestion[] {
  if (query === null || !isGeneral) {
    return []
  }
  return GENERAL_COMMANDS.filter(command => command.name.startsWith(query)).map(command => ({ ...command, kind: 'command' as const }))
}

/**
 * Flags and values for `/new`, while the last word is a dash or the word after `--model`/`-m`. Null when no argument is being typed.
 * Typing `/new -` offers the flags; `/new --model ` offers the model names.
 */
export function argumentSuggestions(text: string, isGeneral: boolean): CommandSuggestion[] | null {
  if (!isGeneral || !/^\/new(\s|$)/.test(text)) {
    return null
  }
  const endsWithSpace = /\s$/.test(text)
  const words = text.trim().split(/\s+/)
  if (words.length < 2 && !endsWithSpace) {
    return null
  }
  const current = endsWithSpace ? '' : (words[words.length - 1] ?? '')
  const previous = endsWithSpace ? words[words.length - 1] : words[words.length - 2]
  if (previous === '--model' || previous === '-m') {
    return MODEL_VALUES.filter(value => value.name.startsWith(current.toLowerCase()))
  }
  if (current.startsWith('-') || (current === '' && previous === '/new')) {
    return NEW_FLAGS.filter(flag => flag.name.startsWith(current.toLowerCase()))
  }
  return null
}

export function moveCommandSelection(index: number, count: number, direction: -1 | 1): number {
  return count === 0 ? 0 : (index + direction + count) % count
}

export function insertCommand(text: string, name: string): string {
  return text.replace(/(^|\s)\/[\w-]*$/, (_match, prefix: string) => `${prefix}/${name} `)
}

/** Replaces the word being typed with a flag or value and leaves a space after it, ready for the next word. */
export function insertArgument(text: string, value: string): string {
  if (/\s$/.test(text) || text === '') {
    return `${text}${value} `
  }
  return text.replace(/\S+$/, `${value} `)
}

/** Inserts whatever a suggestion is: a command name after a slash, or a flag or value as a word. */
export function applySuggestion(text: string, suggestion: CommandSuggestion): string {
  return suggestion.kind === undefined || suggestion.kind === 'command' ? insertCommand(text, suggestion.name) : insertArgument(text, suggestion.name)
}
