import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import type ProjectFile from '#models/project_file'

const client = new SQSClient({ region: env.get('AWS_REGION') })

/**
 * Publishes a slicing job for the given project file. No-ops (with a warning)
 * when SQS_SLICING_QUEUE_URL isn't set, since the queue/Lambda infra for the
 * slicer microservice hasn't been provisioned yet.
 */
export async function enqueueSlicingJob(projectFile: ProjectFile, material: string) {
  const queueUrl = env.get('SQS_SLICING_QUEUE_URL')
  if (!queueUrl) {
    logger.warn(
      { projectFileUuid: projectFile.uuid },
      'SQS_SLICING_QUEUE_URL is not set, skipping slicing job enqueue'
    )
    return
  }

  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        projectFileUuid: projectFile.uuid,
        fileStorageKey: projectFile.fileStorageKey,
        material,
      }),
    })
  )
}
