/**
 * Bridges slicer output (ProjectFile + Material) into normalized pricing inputs.
 *
 * Everything unit-sensitive is resolved here, once, so the calculator receives
 * plain grams / decimal hours / millimeters and never has to know where they
 * came from.
 */
import logger from '@adonisjs/core/services/logger'
import type Material from '#models/material'
import type ProjectFile from '#models/project_file'
import { InvalidPricingInputError, type FdmPricingInputs } from '#services/fdm_pricing_calculator'

const SECONDS_PER_HOUR = 3600

/**
 * Skirt, brim, purge and priming extrusion legitimately land in the residual
 * between the slicer's reported total and the model+support split, so a small
 * positive residual is expected. Beyond this share of the total - or any
 * negative residual, which would mean the parts exceed the whole - something is
 * wrong with the upstream classification and is worth a look.
 */
const RECONCILIATION_RESIDUAL_WARN_RATIO = 0.1

export function buildFdmPricingInputs(
  projectFile: ProjectFile,
  material: Material,
  quantity: number
): FdmPricingInputs {
  const problems: string[] = []

  if (projectFile.status !== 'completed') {
    problems.push(
      `project file ${projectFile.uuid} has status "${projectFile.status}"; slicing must be completed before pricing`
    )
  }

  const required: [string, number | null][] = [
    ['modelMaterialGrams', projectFile.modelMaterialGrams],
    ['supportMaterialGrams', projectFile.supportMaterialGrams],
    ['printTimeEstimatedSeconds', projectFile.printTimeEstimatedSeconds],
    ['x', projectFile.x],
    ['y', projectFile.y],
    ['z', projectFile.z],
  ]
  for (const [field, value] of required) {
    if (value === null || value === undefined) {
      problems.push(`project file ${projectFile.uuid} is missing ${field}`)
    }
  }

  if (material.trueCostPerGram === null || material.trueCostPerGram === undefined) {
    problems.push(
      `material "${material.name}" has no trueCostPerGram; the bulk floor cannot be priced without it`
    )
  }

  if (problems.length > 0) {
    throw new InvalidPricingInputError(problems)
  }

  const modelGrams = projectFile.modelMaterialGrams!
  const supportGrams = projectFile.supportMaterialGrams!

  // The slicer reports its own filament total per variant. baseline is the
  // variant the top-level project_file fields mirror, so it is the one to
  // reconcile against.
  const baselineVariant = (projectFile.sliceVariants ?? []).find(
    (variant) => variant.variant === 'baseline'
  )
  const totalFilamentGrams = baselineVariant ? baselineVariant.filamentUsedGrams : null

  let otherProcessGrams: number | null = null
  if (totalFilamentGrams !== null) {
    otherProcessGrams = totalFilamentGrams - modelGrams - supportGrams

    if (
      otherProcessGrams < 0 ||
      otherProcessGrams > totalFilamentGrams * RECONCILIATION_RESIDUAL_WARN_RATIO
    ) {
      logger.warn(
        {
          projectFileUuid: projectFile.uuid,
          totalFilamentGrams,
          modelGrams,
          supportGrams,
          otherProcessGrams,
        },
        'Filament reconciliation residual outside the expected range'
      )
    }
  }

  return {
    quantity,
    modelGrams,
    supportGrams,
    printHours: projectFile.printTimeEstimatedSeconds! / SECONDS_PER_HOUR,
    trueFilamentCostPerGram: Number(material.trueCostPerGram),
    // Stored in millimeters by the slicer service - no conversion here on
    // purpose (see prusa-slicer's _read_dimensions).
    xMm: projectFile.x!,
    yMm: projectFile.y!,
    zMm: projectFile.z!,
    otherProcessGrams,
    totalFilamentGrams,
  }
}
