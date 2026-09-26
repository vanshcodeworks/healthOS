import { type z } from "zod";
import { HealthOSError, SchemaError } from "@hc/core";

export * from "./primitives.js";
export { EvidenceLevel, EVIDENCE_RANK } from "./primitives.js";
export * from "./content.js";
export * from "./storyboard.js";
export * from "./pipeline.js";

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  issues: { path: string; message: string }[];
}

function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/** Non-throwing validation, for gates that report many findings at once. */
export function validate<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  label = "value",
): ValidationResult<z.infer<S>> {
  const result = schema.safeParse(value);
  if (result.success) {
    // `ZodTypeAny` erases the output type, so `result.data` arrives as `any`.
    // The generic parameter is what carries the real type, and this is the one
    // place it is reattached.
    const data = result.data as z.infer<S>;
    return { ok: true, data, issues: [] };
  }
  return { ok: false, issues: formatIssues(result.error).map((i) => ({ ...i, message: `${label}: ${i.message}` })) };
}

/** Throwing validation for stage boundaries. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, label = "value"): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data as z.infer<S>;
  const issues = formatIssues(result.error);
  throw new SchemaError(
    `${label} failed validation (${issues.length} issue${issues.length === 1 ? "" : "s"}): ${issues
      .slice(0, 6)
      .map((i) => `${i.path} -> ${i.message}`)
      .join("; ")}`,
    {
      details: { label, issues: issues.slice(0, 50) },
      remediation: "Fix the producing stage. Do not bypass schema validation with --force.",
    },
  );
}

/** Parse JSON text then validate. Used when loading persisted storyboards. */
export function parseJson<S extends z.ZodTypeAny>(
  schema: S,
  json: string,
  label = "json",
): z.infer<S> {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new SchemaError(`${label} is not valid JSON`, { cause: error as Error });
  }
  return parse(schema, value, label);
}

export function assertSchema<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  label: string,
): asserts value is z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HealthOSError(`${label} is not valid`, { category: "SCHEMA_VIOLATION" });
  }
}

