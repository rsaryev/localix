import { describe, expect, test } from 'bun:test'
import {
  baseName,
  buildComposeCommand,
  buildDockerBuildCommand,
  defaultBuildTag,
  detectManifestKind,
  dirName,
} from './dockerManifestCommands'

describe('detectManifestKind', () => {
  test('Dockerfile variants', () => {
    expect(detectManifestKind('/app/Dockerfile')).toBe('dockerfile')
    expect(detectManifestKind('/app/dockerfile')).toBe('dockerfile')
    expect(detectManifestKind('/app/api.Dockerfile')).toBe('dockerfile')
  })
  test('compose variants', () => {
    expect(detectManifestKind('/app/docker-compose.yml')).toBe('compose')
    expect(detectManifestKind('/app/docker-compose.yaml')).toBe('compose')
    expect(detectManifestKind('/app/compose.yml')).toBe('compose')
    expect(detectManifestKind('/app/compose.yaml')).toBe('compose')
  })
  test('non-manifests', () => {
    expect(detectManifestKind('/app/index.ts')).toBe(null)
    expect(detectManifestKind('/app/values.yml')).toBe(null)
    expect(detectManifestKind('/app/Dockerfile.md')).toBe(null)
  })
})

describe('path helpers', () => {
  test('baseName / dirName', () => {
    expect(baseName('/a/b/Dockerfile')).toBe('Dockerfile')
    expect(dirName('/a/b/Dockerfile')).toBe('/a/b')
    expect(dirName('Dockerfile')).toBe('.')
    expect(dirName('C:\\proj\\Dockerfile')).toBe('C:\\proj')
  })
  test('defaultBuildTag = lowercased context dir name', () => {
    expect(defaultBuildTag('/home/me/My App/Dockerfile')).toBe('my-app')
    expect(defaultBuildTag('Dockerfile')).toBe('app')
  })
})

describe('command builders (quoting)', () => {
  test('docker build quotes path/tag/context', () => {
    expect(buildDockerBuildCommand('/a b/Dockerfile', 'myimg')).toBe(
      "docker build -f '/a b/Dockerfile' -t 'myimg' '/a b'",
    )
  })
  test('escapes single quotes', () => {
    expect(buildDockerBuildCommand("/it's/Dockerfile", 'x')).toContain("'/it'\\''s/Dockerfile'")
  })
  test('compose actions', () => {
    expect(buildComposeCommand('/a/compose.yml', 'up')).toBe(
      "docker compose -f '/a/compose.yml' up -d",
    )
    expect(buildComposeCommand('/a/compose.yml', 'down')).toBe(
      "docker compose -f '/a/compose.yml' down",
    )
    expect(buildComposeCommand('/a/compose.yml', 'ps')).toBe(
      "docker compose -f '/a/compose.yml' ps",
    )
    expect(buildComposeCommand('/a/compose.yml', 'logs')).toBe(
      "docker compose -f '/a/compose.yml' logs -f",
    )
    expect(buildComposeCommand('/a/compose.yml', 'build')).toBe(
      "docker compose -f '/a/compose.yml' build",
    )
  })
})
