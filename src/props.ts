// Prefixes are component-owned namespaces. Values, including units and callbacks,
// pass through untouched; construction and layout decide how to interpret them.
type Prefixed<Prefix extends string, Props> = {
  [Key in keyof Props as Key extends string ? `${Prefix}_${Key}` : never]: Props[Key];
};

type Scoped<Props, Prefix extends string, Prefixes extends string, Keep extends string> = {
  [Key in keyof Props as Key extends Keep ? never
    : Key extends `${Prefix}_${infer Name}`
      ? Key extends `${Extract<Prefixes, `${Prefix}_${string}`>}_${string}` ? never : Name
      : never]: Props[Key];
};
type Split<Prefixes extends readonly string[], Props, Keep extends string> = [
  ...{ [Index in keyof Prefixes]: Scoped<Props, Prefixes[Index], Prefixes[number], Keep> },
  { [Key in keyof Props as Key extends Keep ? Key
    : Key extends `${Prefixes[number]}_${string}` ? never : Key]: Props[Key] },
];

// The longest matching prefix wins, independently of the caller's prefix order.
// Exact reserved keys stay with the owner, e.g. Arrow.head_size or Axis.line_height.
function prefix_split<const Prefixes extends readonly string[], Props extends object,
  const Keep extends readonly string[] = readonly []>(
  prefixes: Prefixes, props: Props, keep?: Keep,
): Split<Prefixes, Props, Keep[number]> {
  const parts: [string, unknown][][] = prefixes.map(() => []);
  const rest: [string, unknown][] = [];
  const matches = prefixes.map((prefix, index) => ({ prefix: `${prefix}_`, index }))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  for (const [key, value] of Object.entries(props)) {
    const match = keep?.includes(key) ? undefined : matches.find(item => key.startsWith(item.prefix));
    if (match) parts[match.index].push([key.slice(match.prefix.length), value]);
    else rest.push([key, value]);
  }
  return [...parts, rest].map(entries => Object.fromEntries(entries)) as Split<Prefixes, Props, Keep[number]>;
}

function prefix_join<const Prefix extends string, Props extends object>(
  prefix: Prefix, props: Props,
): Prefixed<Prefix, Props> {
  const entries = Object.entries(props).map(([key, value]) => [`${prefix}_${key}`, value]);
  return Object.fromEntries(entries) as Prefixed<Prefix, Props>;
}

// Existing *_style objects are the canonical source form for built-in parts.
// Only supplied flat props add an override, preserving absent/undefined defaults.
function scope_props<Props extends object>(props: Props, prefixes: readonly string[], keep: readonly string[] = []): Props {
  const parts = prefix_split(prefixes, props, [...keep, ...prefixes.map(prefix => `${prefix}_style`)]);
  const result = parts.pop()! as Record<string, unknown>;
  prefixes.forEach((prefix, index) => {
    if (Object.keys(parts[index]).length) {
      const key = `${prefix}_style`;
      result[key] = { ...result[key] as object, ...parts[index] };
    }
  });
  return result as Props;
}

// Resolve each layer's spellings before applying specificity. Only named part
// option records merge; units, arrays, Elements, and other values stay atomic.
function merge_scoped<Props extends object>(layers: readonly (Props | undefined)[],
  prefixes: readonly string[], keep: readonly string[] = []): Props {
  let result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    const props = scope_props(layer, prefixes, keep) as Record<string, unknown>;
    const merged = { ...result, ...props };
    for (const prefix of prefixes) {
      const key = `${prefix}_style`;
      if (result[key] && props[key]) merged[key] = { ...result[key] as object, ...props[key] as object };
    }
    result = merged;
  }
  return result as Props;
}

export { prefix_split, prefix_join, scope_props, merge_scoped };
export type { Prefixed };
