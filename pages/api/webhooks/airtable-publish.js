// Absolute minimum version - no imports, no functions, just a basic handler

export default function handler(req, res) {
  res.status(200).json({ status: 'ok' });
}