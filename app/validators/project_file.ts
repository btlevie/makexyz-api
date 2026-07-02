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
  files: vine.array(
    vine.file({
      size: '20mb',
      extnames: [...ALLOWED_EXTENSIONS],
    })
  ),
  projectUuid: vine.string().uuid().optional(),
})
