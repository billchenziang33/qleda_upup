const DEFAULT_TARGET_URL = "https://qleda-api-263206-10-1437709388.sh.run.tcloudbase.com/health";

exports.main = async (event = {}) => {
  const targetUrl = event.targetUrl || process.env.KEEPALIVE_TARGET_URL || DEFAULT_TARGET_URL;
  const startedAt = Date.now();

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "user-agent": "qleda-cloudbase-keepalive/1.0"
      },
      signal: AbortSignal.timeout(15000)
    });

    const body = await response.text();

    console.log(
      JSON.stringify({
        targetUrl,
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - startedAt
      })
    );

    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: body.slice(0, 500)
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        targetUrl,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      })
    );

    return {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};
