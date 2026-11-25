import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

type TmdbMovie = {
  id?: number;
  title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  runtime?: number | null;
  tagline?: string;
  genres?: Array<{ name?: string }>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Use POST for movie searches." }, 405);
  }

  const accessToken = Deno.env.get("TMDB_API_READ_ACCESS_TOKEN");
  if (!accessToken) {
    return jsonResponse({ error: "TMDB search is not configured yet." }, 503);
  }

  let body: { action?: unknown; query?: unknown; movieId?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  const action = body.action;
  const url = new URL("https://api.themoviedb.org/3/");
  url.searchParams.set("language", "en-US");

  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 100) {
      return jsonResponse({ error: "Movie title must be between 2 and 100 characters." }, 400);
    }

    url.pathname += "search/movie";
    url.searchParams.set("query", query);
    url.searchParams.set("include_adult", "false");
  } else if (action === "details") {
    const movieId = body.movieId;
    if (!Number.isSafeInteger(movieId) || (movieId as number) <= 0) {
      return jsonResponse({ error: "A valid TMDB movie ID is required." }, 400);
    }
    url.pathname += `movie/${movieId}`;
  } else {
    return jsonResponse({ error: "Action must be search or details." }, 400);
  }

  try {
    const tmdbResponse = await fetch(url, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (!tmdbResponse.ok) {
      return jsonResponse({ error: "TMDB could not complete the request. Try again later." }, 502);
    }

    const result = await tmdbResponse.json();
    if (action === "search") {
      const results = Array.isArray(result.results)
        ? result.results
            .filter((movie: TmdbMovie) => Number.isSafeInteger(movie.id) && typeof movie.title === "string")
            .map((movie: TmdbMovie) => ({
              id: movie.id,
              title: movie.title,
              overview: movie.overview ?? "",
              release_date: movie.release_date ?? "",
              poster_path: movie.poster_path ?? null,
              vote_average: movie.vote_average ?? null,
            }))
        : [];
      return jsonResponse({ results });
    }

    const movie = result as TmdbMovie;
    if (!Number.isSafeInteger(movie.id) || typeof movie.title !== "string") {
      return jsonResponse({ error: "TMDB did not return that movie." }, 404);
    }

    return jsonResponse({
      movie: {
        id: movie.id,
        title: movie.title,
        overview: movie.overview ?? "",
        release_date: movie.release_date ?? "",
        poster_path: movie.poster_path ?? null,
        vote_average: movie.vote_average ?? null,
        runtime: movie.runtime ?? null,
        tagline: movie.tagline ?? "",
        genres: Array.isArray(movie.genres)
          ? movie.genres.map((genre) => genre.name).filter((name): name is string => Boolean(name))
          : [],
      },
    });
  } catch {
    return jsonResponse({ error: "Could not reach TMDB. Check your connection and try again." }, 502);
  }
});
