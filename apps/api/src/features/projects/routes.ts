import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import { defaultErrorHandler } from '../../lib/http'
import type { AppContext } from '../../app'
import {
  type CreateProjectRequest,
  type ExpandRefsRequest,
  type ExpandRefsResponse,
  type Project,
  type ResolveProjectByPathResponse,
  type UpdateProjectRequest,
  createProjectRequestSchema,
  expandRefsRequestSchema,
  expandRefsResponseSchema,
  listProjectsResponseSchema,
  projectParamsSchema,
  projectSchema,
  resolveProjectByPathRequestSchema,
  resolveProjectByPathResponseSchema,
  updateProjectRequestSchema,
} from './contracts'
import {
  type InspectPathResponse,
  inspectPathRequestSchema,
  inspectPathResponseSchema,
} from './inspect-path'

export interface ProjectsRoutesService {
  listProjects(userId: string): Promise<{ projects: Project[] }>
  createProject(userId: string, input: CreateProjectRequest): Promise<Project>
  resolveProjectByPath(userId: string, inputPath: string): Promise<ResolveProjectByPathResponse>
  inspectPath(userId: string, inputPath: string): Promise<InspectPathResponse>
  getProject(userId: string, id: string): Promise<Project>
  updateProject(userId: string, id: string, patch: UpdateProjectRequest): Promise<Project>
  deleteProject(userId: string, id: string): Promise<void>
  pickDirectory(): Promise<{ path: string | null }>
  pickFiles(): Promise<{ paths: string[] }>
  expandRefs(userId: string, input: ExpandRefsRequest): Promise<ExpandRefsResponse>
  openProjectDirectory(userId: string, id: string): Promise<{ opened: true }>
}

export function createProjectsRoutes(service: ProjectsRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', async (c) => {
      const response = await service.listProjects(c.get('userId'))
      return c.json(listProjectsResponseSchema.parse(response), 200)
    })
    .post('/', zValidator('json', createProjectRequestSchema), async (c) => {
      const body = c.req.valid('json')
      const response = await service.createProject(c.get('userId'), body)
      return c.json(projectSchema.parse(response), 201)
    })
    .post('/resolve-path', zValidator('json', resolveProjectByPathRequestSchema), async (c) => {
      const { path } = c.req.valid('json')
      const response = await service.resolveProjectByPath(c.get('userId'), path)
      return c.json(resolveProjectByPathResponseSchema.parse(response), 200)
    })
    .post('/inspect-path', zValidator('json', inspectPathRequestSchema), async (c) => {
      const { path } = c.req.valid('json')
      const response = await service.inspectPath(c.get('userId'), path)
      return c.json(inspectPathResponseSchema.parse(response), 200)
    })
    .post('/expand-refs', zValidator('json', expandRefsRequestSchema), async (c) => {
      const response = await service.expandRefs(c.get('userId'), c.req.valid('json'))
      return c.json(expandRefsResponseSchema.parse(response), 200)
    })
    .post('/pick-dir', async (c) => {
      const response = await service.pickDirectory()
      return c.json(response, 200)
    })
    .post('/pick-files', async (c) => {
      const response = await service.pickFiles()
      return c.json(response, 200)
    })
    .post('/:id/open', zValidator('param', projectParamsSchema), async (c) => {
      const { id } = c.req.valid('param')
      const response = await service.openProjectDirectory(c.get('userId'), id)
      return c.json(response, 200)
    })
    .get('/:id', zValidator('param', projectParamsSchema), async (c) => {
      const { id } = c.req.valid('param')
      const response = await service.getProject(c.get('userId'), id)
      return c.json(projectSchema.parse(response), 200)
    })
    .patch(
      '/:id',
      zValidator('param', projectParamsSchema),
      zValidator('json', updateProjectRequestSchema),
      async (c) => {
        const { id } = c.req.valid('param')
        const body = c.req.valid('json')
        const response = await service.updateProject(c.get('userId'), id, body)
        return c.json(projectSchema.parse(response), 200)
      },
    )
    .delete('/:id', zValidator('param', projectParamsSchema), async (c) => {
      const { id } = c.req.valid('param')
      await service.deleteProject(c.get('userId'), id)
      return c.body(null, 204)
    })

  routes.onError(defaultErrorHandler)

  return routes
}
