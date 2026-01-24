import { query } from '../db/index.ts';
import { authenticateToken, requireRole } from '../middleware/auth.ts';
import {
  requireNonEmptyString,
  requireNonEmptyString,
  validateHexColor,
  badRequest,
} from '../utils/validation.ts';

export default async function (fastify, _opts) {
  // GET / - List all projects
  fastify.get(
    '/',
    {
      onRequest: [authenticateToken],
    },
    async (request, _reply) => {
      let queryText = `
            SELECT id, name, client_id, color, description, is_disabled 
            FROM projects ORDER BY name
        `;
      let queryParams = [];

      if (request.user.role === 'user') {
        queryText = `
                SELECT p.id, p.name, p.client_id, p.color, p.description, p.is_disabled 
                FROM projects p
                INNER JOIN user_projects up ON p.id = up.project_id
                WHERE up.user_id = $1
                ORDER BY p.name
            `;
        queryParams = [request.user.id];
      }

      const result = await query(queryText, queryParams);

      const projects = result.rows.map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.client_id,
        color: p.color,
        description: p.description,
        isDisabled: p.is_disabled,
      }));

      return projects;
    },
  );

  // POST / - Create project (manager only)
  fastify.post(
    '/',
    {
      onRequest: [authenticateToken, requireRole('manager')],
    },
    async (request, reply) => {
      const { name, clientId, description, color } = request.body;

      const nameResult = requireNonEmptyString(name, 'name');
      if (!nameResult.ok) return badRequest(reply, nameResult.message);

      const clientIdResult = requireNonEmptyString(clientId, 'clientId');
      if (!clientIdResult.ok) return badRequest(reply, clientIdResult.message);

      const id = 'p-' + Date.now();
      const colorResult = color ? validateHexColor(color, 'color') : null;
      if (color && !colorResult.ok) {
        return badRequest(reply, colorResult.message);
      }
      const projectColor = colorResult?.value || '#3b82f6';

      try {
        await query(
          `INSERT INTO projects (id, name, client_id, color, description, is_disabled) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, nameResult.value, clientIdResult.value, projectColor, description || null, false],
        );

        return reply.code(201).send({
          id,
          name: nameResult.value,
          clientId: clientIdResult.value,
          color: projectColor,
          description,
          isDisabled: false,
        });
      } catch (err) {
        if (err.code === '23503') {
          // Foreign key violation
          return reply.code(400).send({ error: 'Client not found' });
        }
        throw err;
      }
    },
  );

  // DELETE /:id - Delete project (manager only)
  fastify.delete(
    '/:id',
    {
      onRequest: [authenticateToken, requireRole('manager')],
    },
    async (request, reply) => {
      const { id } = request.params;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);

      const result = await query('DELETE FROM projects WHERE id = $1 RETURNING id', [
        idResult.value,
      ]);
      if (result.rows.length === 0) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      return { message: 'Project deleted' };
    },
  );

  // PUT /:id - Update project (manager only)
  fastify.put(
    '/:id',
    {
      onRequest: [authenticateToken, requireRole('manager')],
    },
    async (request, reply) => {
      const { id } = request.params;
      const { name, clientId, description, color, isDisabled } = request.body;
      const idResult = requireNonEmptyString(id, 'id');
      if (!idResult.ok) return badRequest(reply, idResult.message);
      if (color !== undefined && color !== null && color !== '') {
        const colorResult = validateHexColor(color, 'color');
        if (!colorResult.ok) return badRequest(reply, colorResult.message);
      }

      try {
        const result = await query(
          `UPDATE projects 
                 SET name = COALESCE($1, name), 
                     client_id = COALESCE($2, client_id), 
                     color = COALESCE($3, color), 
                     description = COALESCE($4, description), 
                     is_disabled = COALESCE($5, is_disabled)
                 WHERE id = $6
                 RETURNING id, name, client_id, color, description, is_disabled`,
          [
            name || null,
            clientId || null,
            color || null,
            description || null,
            isDisabled,
            idResult.value,
          ],
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Project not found' });
        }

        const updated = result.rows[0];

        return {
          id: updated.id,
          name: updated.name,
          clientId: updated.client_id,
          color: updated.color,
          description: updated.description,
          isDisabled: updated.is_disabled,
        };
      } catch (err) {
        if (err.code === '23503') {
          // Foreign key violation
          return reply.code(400).send({ error: 'Client not found' });
        }
        throw err;
      }
    },
  );
}
