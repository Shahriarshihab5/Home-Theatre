// Vercel serverless adapter — reuses the same Express app as the local server.
// Deploying here is optional: in-app playback needs an HTTP origin (CircleFTP is HTTP-only),
// so the home-network server is the recommended setup for TV viewing.
import app from '../server/app.js'

export default app
