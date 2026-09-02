const FUNCTION_ROOT = "/home/deno/functions";

const envVars = [
  ["SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? ""],
  ["SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""],
  ["SUPABASE_ANON_KEY", Deno.env.get("SUPABASE_ANON_KEY") ?? ""],
  ["CRON_SECRET", Deno.env.get("CRON_SECRET") ?? ""],
  ["RESEND_API_KEY", Deno.env.get("RESEND_API_KEY") ?? ""],
  ["DEMO_USER_PASSWORD", Deno.env.get("DEMO_USER_PASSWORD") ?? ""],
  ["DENO_ORIGIN", Deno.env.get("DENO_ORIGIN") ?? ""],
  ["JWT_VERIFY_KEY", Deno.env.get("JWT_VERIFY_KEY") ?? ""],
];

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);

    // Ожидаем /functions/v1/<function-name>
    const match = url.pathname.match(/^\/functions\/v1\/([^/]+)(\/.*)?$/);

    if (!match) {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "openhr-edge-runtime",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const functionName = match[1];

    // Не позволяем выходить за пределы каталога functions
    if (!/^[a-zA-Z0-9_-]+$/.test(functionName)) {
      return new Response(
        JSON.stringify({ error: "Invalid function name" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const servicePath = `${FUNCTION_ROOT}/${functionName}`;

    console.log(`Routing request to function: ${functionName}`);

    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 256,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });

    return await worker.fetch(req);
  } catch (e) {
    console.error("Edge function routing error:", e);

    return new Response(
      JSON.stringify({
        error: "Edge function failed",
        message: e instanceof Error ? e.message : String(e),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});