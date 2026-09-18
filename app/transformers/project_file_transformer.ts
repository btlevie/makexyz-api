import { BaseTransformer } from '@adonisjs/core/transformers'
import type ProjectFile from '#models/project_file'

export default class ProjectFileTransformer extends BaseTransformer<ProjectFile> {
  async toObject() {
    return {
      uuid: this.resource.uuid,
      originalName: this.resource.originalName,
      mimeType: this.resource.mimeType,
      size: this.resource.fileSize,
      technology: this.resource.technology,
      status: this.resource.status,
      // Last-known progress from the slicer's best-effort progress callback -
      // both null until the first progress event arrives. Lets a client that
      // reconnects mid-slice (transmit doesn't buffer missed events) recover
      // current state from a plain GET instead of only the live stream.
      slicingProgressPercent: this.resource.slicingProgressPercent,
      slicingProgressStage: this.resource.slicingProgressStage,
      material: this.resource.material
        ? { uuid: this.resource.material.uuid, name: this.resource.material.name }
        : null,
      color: this.resource.color
        ? {
            uuid: this.resource.color.uuid,
            name: this.resource.color.name,
            hex: this.resource.color.hex,
          }
        : null,
      // Slicer-derived. All null until slicing completes - including right after
      // a technology switch, which clears them and re-queues the file.
      volume: this.resource.volume,
      dimensionsMm: {
        x: this.resource.x,
        y: this.resource.y,
        z: this.resource.z,
      },
      surfaceAreaMm2: this.resource.surfaceAreaMm2,
      infill: this.resource.infill,
      layerHeight: this.resource.layerHeight,
      modelMaterialGrams: this.resource.modelMaterialGrams,
      supportMaterialGrams: this.resource.supportMaterialGrams,
      printTimeEstimatedSeconds: this.resource.printTimeEstimatedSeconds,
    }
  }
}
