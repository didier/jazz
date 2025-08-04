import { BetterAuthDbSchema, FieldAttribute } from "better-auth/db";
import { Group, co, z } from "jazz-tools";

type ZodPrimitiveSchema =
  | z.z.ZodString
  | z.z.ZodNumber
  | z.z.ZodBoolean
  | z.z.ZodNull
  | z.z.ZodDate
  | z.z.ZodLiteral;

type ZodOptionalPrimitiveSchema = z.z.ZodOptional<ZodPrimitiveSchema>;

type RootSchema = Record<keyof BetterAuthDbSchema, co.List<co.Map<any>>>;
type DbSchema = Record<keyof BetterAuthDbSchema, co.Map<any>>;

type Account = co.Account<{
  profile: co.Profile;
  root: co.Map<{
    group: typeof Group;
    tables: co.Map<RootSchema>;
  }>;
}>;

export type WorkerAccount = co.loaded<Account>;

type JazzSchema = {
  WorkerAccount: Account;
  dbSchema: DbSchema;
  rootSchema: RootSchema;
};

export function createJazzSchema(schema: BetterAuthDbSchema): JazzSchema {
  const dbSchema: DbSchema = {};
  const rootSchema: RootSchema = {};

  for (const [key, value] of Object.entries(schema)) {
    const modelShape: Record<
      string,
      ZodPrimitiveSchema | ZodOptionalPrimitiveSchema
    > = {};

    for (const [fieldName, field] of Object.entries(value.fields)) {
      modelShape[field.fieldName || fieldName] = convertFieldToCoValue(field);
    }

    const coMap = co.map(modelShape);
    dbSchema[key] = coMap;
    rootSchema[key] = co.list(coMap);
  }

  const rootMap = co.map({
    group: Group,
    tables: co.map(rootSchema),
  });

  const WorkerAccount: Account = co
    .account({
      profile: co.profile(),
      root: rootMap,
    })
    .withMigration(async (account) => {
      if (account.root === undefined) {
        // Create a group for the first time
        // it will be the owner of the all tables and data
        const adminGroup = Group.create();

        const rootValues = Object.fromEntries(
          Object.entries(rootSchema).map(([key, value]) => [
            key,
            value.create([], adminGroup),
          ]),
        );

        account.root = rootMap.create({
          group: adminGroup,
          tables: co.map(rootSchema).create(rootValues, adminGroup),
        });
      }

      const { root } = await account.ensureLoaded({
        resolve: {
          root: {
            group: true,
            tables: true,
          },
        },
      });

      for (const [key, value] of Object.entries(rootSchema)) {
        if (root.tables[key] === undefined) {
          root.tables[key] = value.create([], root.group);
        }
      }
    });

  return {
    WorkerAccount,
    dbSchema,
    rootSchema,
  };
}

function convertFieldToCoValue(field: FieldAttribute) {
  let zodType: ZodPrimitiveSchema | ZodOptionalPrimitiveSchema;

  switch (field.type) {
    case "string":
      zodType = z.string();
      break;
    case "number":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "date":
      zodType = z.date();
      break;
    default:
      throw new Error(`Unsupported field type: ${field.type}`);
  }

  if (field.required === false) {
    zodType = zodType.optional();
  }

  return zodType;
}
