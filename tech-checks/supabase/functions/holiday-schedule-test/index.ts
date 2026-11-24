// Disabled stub. A deploy replaces live holiday-schedule-test. This file must not call a camera.

export function handleHolidayScheduleTest(_request: Request): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'holiday-schedule-test is disabled; it may not write camera schedules',
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
  Deno.serve(handleHolidayScheduleTest);
}
