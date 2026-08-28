import type {
  DefineToolOptions,
  InferArgs,
  ParameterSchemaSpec,
  ToolDefinition,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

type SchemaRecord = Record<string, any>

type CustomerToolOptions<
  S extends ParameterSchemaSpec,
  O extends ValueSchemaSpec,
> = DefineToolOptions<S, O> & {
  readonly strictParameters?: boolean
}

class RuntimeNeutralToolArgsError extends Error {
  constructor(errors: readonly string[]) {
    super(`工具参数无效：${errors.join(' ')}`)
    this.name = 'ToolArgsError'
  }
}

function compileValueSchema(spec: SchemaRecord): SchemaRecord {
  if (Array.isArray(spec.oneOf)) {
    return {
      ...spec,
      oneOf: spec.oneOf.map((item: SchemaRecord) => compileValueSchema(item)),
    }
  }

  const { required: _required, ...schema } = spec
  if (schema.type === 'json') {
    const { type: _type, ...annotations } = schema
    return annotations
  }
  if (schema.type === 'array' && schema.items) {
    return { ...schema, items: compileValueSchema(schema.items) }
  }
  if (schema.type === 'object' && schema.properties) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, value]) => [
        name,
        compileValueSchema(value as SchemaRecord),
      ]),
    )
    const required = Object.entries(schema.properties)
      .filter(([, value]) => (value as SchemaRecord).required === true)
      .map(([name]) => name)
    return {
      ...schema,
      properties,
      ...(required.length > 0 ? { required } : {}),
    }
  }
  return schema
}

function compileParameterSchema(spec: ParameterSchemaSpec): SchemaRecord {
  const properties = Object.fromEntries(
    Object.entries(spec).map(([name, value]) => [name, compileValueSchema(value)]),
  )
  const required = Object.entries(spec)
    .filter(([, value]) => value.required === true)
    .map(([name]) => name)
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function validateValue(schema: SchemaRecord, value: unknown, path: string): string[] {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.some((item: SchemaRecord) => validateValue(item, value, path).length === 0)
      ? []
      : [`${path} 不符合任何允许的结构。`]
  }
  if (schema.const !== undefined && value !== schema.const) {
    return [`${path} 必须等于 ${JSON.stringify(schema.const)}。`]
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${path} 不在允许值中。`]
  }
  if (schema.type === 'string' && typeof value !== 'string') return [`${path} 必须是字符串。`]
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    return [`${path} 必须是有限数字。`]
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) return [`${path} 必须是整数。`]
  if (schema.type === 'boolean' && typeof value !== 'boolean') return [`${path} 必须是布尔值。`]
  if (schema.type === 'null' && value !== null) return [`${path} 必须是 null。`]
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} 必须是数组。`]
    return schema.items
      ? value.flatMap((item, index) => validateValue(schema.items, item, `${path}[${index}]`))
      : []
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path} 必须是对象。`]
    const record = value as Record<string, unknown>
    const errors = (schema.required ?? [])
      .filter((name: string) => !(name in record))
      .map((name: string) => `${path}.${name} 为必填项。`)
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}))
      for (const name of Object.keys(record)) {
        if (!allowed.has(name)) errors.push(`${path}.${name} 是未知字段。`)
      }
    }
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      if (name in record) errors.push(...validateValue(child as SchemaRecord, record[name], `${path}.${name}`))
    }
    return errors
  }
  return []
}

export function defineCustomerTool<
  const S extends ParameterSchemaSpec,
  const O extends ValueSchemaSpec,
>(options: CustomerToolOptions<S, O>): ToolDefinition {
  const parameters = compileParameterSchema(options.parameters)
  if (options.strictParameters) parameters.additionalProperties = false
  const outputSchema = compileValueSchema(options.output.schema)
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (args, value) => options.output.render(args as InferArgs<S>, value as never),
    },
    async execute(args, exec) {
      const errors = validateValue(parameters, args, '$')
      if (errors.length > 0) throw new RuntimeNeutralToolArgsError(errors)
      return options.execute(args as InferArgs<S>, exec)
    },
  }
}
