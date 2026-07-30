/**
 * OpenAPI 3.1 description of the API surface built so far.
 *
 * Hand-written rather than generated from decorators: the spec doubles as the
 * contract the frontend codes against, and keeping it explicit makes it obvious
 * when a route changes shape. Extended as each sprint lands its endpoints.
 */
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'TrustLance API',
    version: '0.1.0',
    description:
      'Portable reputation and milestone escrow for freelancers. Sprint 1 covers auth and profiles; jobs, escrow, reputation and disputes follow in Sprints 2-5.',
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local development' }],
  tags: [
    { name: 'Health', description: 'Liveness and dependency checks' },
    { name: 'Auth', description: 'Registration, login, and rotating refresh tokens' },
    { name: 'Users', description: 'Profiles and public trust pages' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Short-lived (15 min) access token returned by /api/auth/login.',
      },
      refreshCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'trustlance_rt',
        description:
          'httpOnly rotating refresh token, scoped to /api/auth. Set by the server; not readable by JavaScript.',
      },
    },
    schemas: {
      Role: { type: 'string', enum: ['FREELANCER', 'CLIENT', 'ADMIN'] },
      Profile: {
        type: 'object',
        properties: {
          displayName: { type: 'string' },
          bio: { type: 'string', nullable: true },
          skills: { type: 'array', items: { type: 'string' } },
          hourlyRateCents: {
            type: 'integer',
            nullable: true,
            description: 'Integer cents. Never a float — see documentation §11.',
          },
          portfolioLinks: { type: 'array', items: { type: 'string', format: 'uri' } },
        },
      },
      Me: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          role: { $ref: '#/components/schemas/Role' },
          emailVerified: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          profile: { $ref: '#/components/schemas/Profile' },
        },
      },
      PublicUser: {
        type: 'object',
        description: 'Public trust profile. Deliberately excludes email.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          role: { $ref: '#/components/schemas/Role' },
          createdAt: { type: 'string', format: 'date-time' },
          trustScore: { type: 'number', nullable: true },
          profile: { $ref: '#/components/schemas/Profile' },
        },
      },
      AuthResponse: {
        type: 'object',
        description:
          'The refresh token is NOT in this body — it is delivered as an httpOnly cookie.',
        properties: {
          accessToken: { type: 'string' },
          expiresIn: { type: 'integer', description: 'Seconds until accessToken expires.' },
          user: { $ref: '#/components/schemas/Me' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Dependency health check',
        description: 'Returns 503 when Postgres or Redis is unreachable, not merely when down.',
        responses: {
          200: { description: 'All dependencies reachable' },
          503: { description: 'Degraded — a dependency is unreachable' },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        description:
          'Role must be FREELANCER or CLIENT. ADMIN is rejected — arbitrators are provisioned out of band.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'role', 'displayName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 12 },
                  role: { type: 'string', enum: ['FREELANCER', 'CLIENT'] },
                  displayName: { type: 'string', minLength: 2 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } },
          },
          400: { description: 'Validation failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Email already registered' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        description:
          'Returns an identical 401 for unknown email and wrong password, and always performs a bcrypt comparison, so login cannot be used to enumerate accounts.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          401: { description: 'Incorrect email or password' },
          429: { description: 'Rate limited' },
        },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token',
        description:
          'Reads the refresh token from the httpOnly cookie only. Each call issues a new token and revokes its predecessor. Presenting an already-used token is treated as theft: the entire token family is revoked and every session from that login dies.',
        security: [{ refreshCookie: [] }],
        responses: {
          200: { description: 'Rotated', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
          401: { description: 'Missing, expired, unknown, or already-used token' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'End the current session',
        description:
          'Does not require an access token, so a user whose access token already expired can still log out.',
        security: [{ refreshCookie: [] }],
        responses: { 204: { description: 'Session revoked' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user',
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } },
          401: { description: 'Missing or invalid access token' },
        },
      },
    },
    '/api/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Own account and profile',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } }, 401: { description: 'Unauthorized' } },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update own profile',
        description:
          'Profile fields only. role, email, emailVerified and trustScore are not editable — a self-editable trust score would make the reputation system meaningless. Unknown keys are rejected outright.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Profile' } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } },
          400: { description: 'Validation failed (including unknown keys and non-integer cents)' },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/api/users/{userId}': {
      get: {
        tags: ['Users'],
        summary: 'Public trust profile',
        description: 'No authentication — anyone doing due diligence must be able to read this.',
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicUser' } } } },
          404: { description: 'User not found' },
        },
      },
    },
  },
} as const;
