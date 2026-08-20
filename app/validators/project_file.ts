import vine from '@vinejs/vine'

const ALLOWED_EXTENSIONS = [
  'stl',
  'obj',
  'dxf',
  'off',
  'ply',
  '3ds',
  'wrl',
  'step',
  'stp',
  'igs',
  'iges',
  'zip',
] as const

export const uploadProjectFileValidator = vine.create({
  projectUuid: vine.string().uuid().optional(),
  files: vine.array(
    vine.file({
      size: '20mb',
      extnames: [...ALLOWED_EXTENSIONS],
    })
  ),
})

const SLICE_VARIANTS = ['baseline', 'infill_probe', 'layer_height_probe'] as const

export const sliceResultValidator = vine.create({
  status: vine.enum(['completed', 'failed'] as const),
  gcodeStorageKey: vine.string().optional(),
  volume: vine.number().optional(),
  x: vine.number().optional(),
  y: vine.number().optional(),
  z: vine.number().optional(),
  infill: vine.number().optional(),
  layerHeight: vine.number().optional(),
  supportMaterialGrams: vine.number().optional(),
  modelMaterialGrams: vine.number().optional(),
  printTimeEstimatedSeconds: vine.number().optional(),
  error: vine.string().optional(),
  variants: vine
    .array(
      vine.object({
        variant: vine.enum(SLICE_VARIANTS),
        infill: vine.number(),
        layerHeight: vine.number(),
        filamentUsedGrams: vine.number(),
        printTimeEstimatedSeconds: vine.number(),
        gcodeStorageKey: vine.string(),
      })
    )
    .minLength(1)
    .distinct('variant')
    .optional(),
})
