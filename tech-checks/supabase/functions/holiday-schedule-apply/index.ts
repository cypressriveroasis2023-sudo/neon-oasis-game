// Disabled stub. A deploy replaces live holiday-schedule-apply. This file must not call a camera.

export function handleHolidayScheduleApply(_request: Request): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'holiday-schedule-apply is disabled; it may not write camera schedules',
    }),
    {
      status: 410,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

declare const Deno: {
  serve: (handler: (request: Request) => Response) => void;
};

if (typeof Deno !== 'undefined') {
  Deno.serve(handleHolidayScheduleApply);
}
