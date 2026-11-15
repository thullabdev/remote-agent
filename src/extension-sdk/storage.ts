/** Field types a collection may index. Stored as TEXT, INTEGER, or INTEGER 0/1. */
export type IndexType = 'text' | 'integer' | 'boolean'

/** A value an indexed field can hold. `null` clears it. */
export type IndexValue = string | number | boolean | null

/** A collection a manifest declares: the fields it indexes, by name and type. */
export type CollectionSpec = { indexes: Record<string, IndexType> }

/** Range bounds for an indexed field. Only indexed fields may be filtered. */
export type RangeBounds = { gt?: IndexValue; gte?: IndexValue; lt?: IndexValue; lte?: IndexValue }

export type CollectionQuery = {
  where?: Record<string, IndexValue | RangeBounds>
  orderBy?: { field: string; dir?: 'asc' | 'desc' }
  /** 1..1000, default 100. */
  limit?: number
}

export type Collection = {
  /** Adds a document. Throws if the id already exists. */
  insert(id: string, doc: unknown, indexed?: Record<string, IndexValue>): void
  /** Adds or replaces a document. Keeps `createdAt` when replacing. */
  upsert(id: string, doc: unknown, indexed?: Record<string, IndexValue>): void
  get<T = unknown>(id: string): T | undefined
  /** True when a document was removed. */
  delete(id: string): boolean
  query<T = unknown>(query?: CollectionQuery): Array<{ id: string; doc: T }>
}

/** Key/value storage and declared collections, scoped to one extension. */
export type ExtensionStorage = {
  get<T = unknown>(key: string): T | undefined
  /** Stores a JSON value. Throws for values JSON cannot represent, and for values over 256 KB. */
  set(key: string, value: unknown): void
  /** True when a key was removed. */
  delete(key: string): boolean
  keys(prefix?: string): string[]
  /** Throws if the manifest does not declare the collection. */
  collection(name: string): Collection
}

export const MAX_VALUE_BYTES = 256 * 1024
export const MAX_QUERY_LIMIT = 1000
export const DEFAULT_QUERY_LIMIT = 100

const KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/
const NAME = /^[a-z][a-z0-9_]{0,31}$/
const FIELD = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/
const RESERVED_FIELDS = new Set(['id', 'doc', 'created_at', 'updated_at'])
const INDEX_TYPES: readonly IndexType[] = ['text', 'integer', 'boolean']

export function isValidKey(key: string): boolean {
  return KEY.test(key)
}

export function assertValidKey(key: string): void {
  if (!KEY.test(key)) {
    throw new Error(`invalid storage key "${key}": use lowercase letters, digits, and . _ : - (1 to 64 characters)`)
  }
}

export function assertValidCollectionName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(`invalid collection name "${name}": use lowercase letters, digits, and _ (starting with a letter)`)
  }
}

export function assertValidField(name: string): void {
  if (!FIELD.test(name) || RESERVED_FIELDS.has(name)) {
    throw new Error(`invalid indexed field "${name}": use letters, digits, and _ (starting with a letter); "id", "doc", "created_at", "updated_at" are reserved`)
  }
}

export function assertIndexType(value: unknown, name: string): asserts value is IndexType {
  if (typeof value !== 'string' || !INDEX_TYPES.includes(value as IndexType)) {
    throw new Error(`indexed field "${name}" must be one of ${INDEX_TYPES.join(', ')}`)
  }
}

/** SQL column type for an index type. */
export function columnType(type: IndexType): 'TEXT' | 'INTEGER' {
  return type === 'text' ? 'TEXT' : 'INTEGER'
}

/** Converts an indexed value to what its column stores, rejecting values of the wrong type. */
export function storedIndexValue(type: IndexType, field: string, value: IndexValue | undefined): string | number | null {
  if (value === undefined || value === null) {
    return null
  }
  if (type === 'text') {
    if (typeof value !== 'string') {
      throw new Error(`indexed field "${field}" is text; got ${typeof value}`)
    }
    return value
  }
  if (type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      throw new Error(`indexed field "${field}" is integer; got ${String(value)}`)
    }
    return value
  }
  if (typeof value !== 'boolean') {
    throw new Error(`indexed field "${field}" is boolean; got ${typeof value}`)
  }
  return value ? 1 : 0
}

/** Serializes a document and checks it is a JSON value within the size limit. */
export function encodeDoc(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new Error('value cannot be stored as JSON')
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_VALUE_BYTES) {
    throw new Error(`value is larger than ${MAX_VALUE_BYTES / 1024} KB`)
  }
  return json
}

/** The SQL-safe table name for a collection: `ext_<extension>__<collection>`. */
export function tableName(extensionId: string, collection: string): string {
  const slug = extensionId.toLowerCase().replace(/[^a-z0-9]/g, '_')
  return `ext_${slug}__${collection}`
}
