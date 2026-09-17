export function GET() {
  return Response.json({
    status: 'ok',
    service: 'admin-web',
    timestamp: new Date().toISOString(),
  });
}
