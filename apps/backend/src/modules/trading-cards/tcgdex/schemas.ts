import { z } from "@medusajs/framework/zod"

const nonEmptyString = z.string().trim().min(1)

const effectSchema = z.object({ name: nonEmptyString, effect: nonEmptyString })

const setSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  logo: z.string().url().optional(),
  symbol: z.string().url().optional(),
  cardCount: z.object({
    official: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  }).optional(),
})

const variantsSchema = z.object({
  normal: z.boolean(),
  reverse: z.boolean(),
  holo: z.boolean(),
  firstEdition: z.boolean(),
  wPromo: z.boolean().optional(),
})

const boosterSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  logo: z.string().url().optional(),
  artwork_front: z.string().url().optional(),
  artwork_back: z.string().url().optional(),
})

export const tcgDexCardSchema = z.object({
  category: nonEmptyString,
  id: nonEmptyString,
  localId: z.union([nonEmptyString, z.number().int().nonnegative()]).transform(String),
  name: nonEmptyString,
  image: z.string().url().optional(),
  illustrator: nonEmptyString.optional(),
  rarity: nonEmptyString.optional(),
  set: setSchema,
  variants: variantsSchema,
  boosters: z.array(boosterSchema).optional(),
  updated: z.string().datetime({ offset: true }).optional(),
  dexId: z.array(z.number().int().positive()).optional(),
  hp: z.number().int().nonnegative().optional(),
  types: z.array(nonEmptyString).optional(),
  evolveFrom: nonEmptyString.optional(),
  description: z.string().optional(),
  level: nonEmptyString.optional(),
  stage: nonEmptyString.optional(),
  suffix: nonEmptyString.optional(),
  item: effectSchema.optional(),
  effect: z.string().optional(),
  trainerType: nonEmptyString.optional(),
  energyType: nonEmptyString.optional(),
})

