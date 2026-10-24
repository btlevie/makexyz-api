import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import sharp from 'sharp'
import { inspectAttachment, matchesExtension } from '#services/attachment_inspection'

async function pngWithExif() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: '#3366ff' } })
    .withExif({ IFD0: { Copyright: 'secret-gps-and-camera-data' } })
    .png()
    .toBuffer()
}

async function pdf(build?: (doc: PDFDocument) => void) {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200]).drawText('Bracket drawing')
  build?.(doc)
  return Buffer.from(await doc.save())
}

/** A PDF whose first page has a link annotation pointing at `uri`. */
function withLink(uri: string) {
  return (doc: PDFDocument) => {
    const page = doc.getPage(0)
    const action = doc.context.obj({ S: 'URI', URI: PDFString.of(uri) })
    const annotation = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: action })
    )
    page.node.set(PDFName.of('Annots'), doc.context.obj([annotation]))
  }
}

function binaryStl(triangles: number) {
  const bytes = Buffer.alloc(84 + triangles * 50)
  bytes.writeUInt32LE(triangles, 80)
  return bytes
}

test.group('Attachment inspection', () => {
  test('images are re-encoded, dropping metadata', async ({ assert }) => {
    const original = await pngWithExif()
    assert.include(original.toString('latin1'), 'secret-gps-and-camera-data')

    const result = await inspectAttachment(original, 'png')
    assert.equal(result.outcome, 'clean')
    assert.equal(result.contentType, 'image/png')
    assert.exists(result.replacement)
    assert.notInclude(result.replacement!.toString('latin1'), 'secret-gps-and-camera-data')
  })

  test('a QR code in an image is decoded for moderation', async ({ assert }) => {
    const bytes = await readFile('tests/fixtures/attachments/qr_link.png')
    const result = await inspectAttachment(bytes, 'png')
    assert.equal(result.outcome, 'clean')
    assert.deepEqual(result.extractedText, ['https://pay-here.example.net/invoice'])
  })

  test('a file that is not what its extension says is rejected', async ({ assert }) => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .jpeg()
      .toBuffer()
    const renamed = await inspectAttachment(jpeg, 'png')
    assert.equal(renamed.reason, 'type_mismatch')
    const notStep = await inspectAttachment(Buffer.from('not a step file'), 'step')
    assert.equal(notStep.reason, 'type_mismatch')
  })

  test('executables and archives are rejected whatever they are called: {$self.name}')
    .with([
      {
        name: 'exe as stl',
        bytes: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]),
        ext: 'stl' as const,
      },
      {
        name: 'zip as obj',
        bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
        ext: 'obj' as const,
      },
      { name: 'script as dxf', bytes: Buffer.from('#!/bin/sh\nrm -rf /'), ext: 'dxf' as const },
    ])
    .run(async ({ assert }, { bytes, ext }) => {
      const result = await inspectAttachment(bytes, ext)
      assert.equal(result.outcome, 'rejected')
      assert.match(result.reason!, /^forbidden_/)
    })

  test('3D/CAD files only need to be what they claim', ({ assert }) => {
    assert.isTrue(matchesExtension(binaryStl(3), 'stl'))
    assert.isTrue(matchesExtension(Buffer.from('solid bracket\nfacet normal 0 0 1\n'), 'stl'))
    assert.isTrue(matchesExtension(Buffer.from('ISO-10303-21;\nHEADER;\n'), 'step'))
    assert.isTrue(matchesExtension(Buffer.from('ply\nformat ascii 1.0\n'), 'ply'))
    assert.isFalse(matchesExtension(Buffer.from([0, 1, 2, 3, 0, 0]), 'obj'))
  })

  test('a plain PDF is clean', async ({ assert }) => {
    const result = await inspectAttachment(await pdf(), 'pdf')
    assert.equal(result.outcome, 'clean')
    assert.deepEqual(result.findings, [])
  })

  test('a PDF with JavaScript is rejected, even inside compressed object streams', async ({
    assert,
  }) => {
    // pdf-lib writes object streams by default, so the script isn't visible in the raw bytes.
    const bytes = await pdf((doc) => doc.addJavaScript('main', 'app.alert("hi")'))
    assert.notInclude(bytes.toString('latin1'), 'app.alert')

    const result = await inspectAttachment(bytes, 'pdf')
    assert.equal(result.outcome, 'rejected')
    assert.equal(result.reason, 'pdf_active_content')
    assert.include(result.findings, 'JavaScript')
  })

  test('PDF link targets are extracted; script links are active content', async ({ assert }) => {
    const linked = await inspectAttachment(
      await pdf(withLink('https://drawings.example.net/x')),
      'pdf'
    )
    assert.equal(linked.outcome, 'clean')
    assert.deepEqual(linked.extractedText, ['https://drawings.example.net/x'])

    const scripted = await inspectAttachment(await pdf(withLink('javascript:alert(1)')), 'pdf')
    assert.equal(scripted.outcome, 'rejected')
    assert.include(scripted.findings, 'script_uri')
  })

  test('an unparseable PDF goes to a person rather than through', async ({ assert }) => {
    const result = await inspectAttachment(
      Buffer.from('%PDF-1.7\ngarbage that is not a pdf'),
      'pdf'
    )
    assert.equal(result.outcome, 'review')
  })
})
