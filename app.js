import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const loginForm = document.querySelector("#login-form");
const emailInput = document.querySelector("#email");
const status = document.querySelector("#status");
const profileSection = document.querySelector("#profile-section");
const profileForm = document.querySelector("#profile-form");
const displayNameInput = document.querySelector("#display-name");
const profileStatus = document.querySelector("#profile-status");
const saveProfileButton = document.querySelector("#save-profile");
const signOutButton = document.querySelector("#sign-out");
const movieSearchSection = document.querySelector("#movie-search-section");
const movieSearchForm = document.querySelector("#movie-search-form");
const movieQueryInput = document.querySelector("#movie-query");
const movieSearchButton = document.querySelector("#movie-search-button");
const movieSearchStatus = document.querySelector("#movie-search-status");
const movieResults = document.querySelector("#movie-results");
const movieDetail = document.querySelector("#movie-detail");
const movieDetailContent = document.querySelector("#movie-detail-content");
const closeMovieDetailButton = document.querySelector("#close-movie-detail");

let activeUserId = null;
let profileLoadVersion = 0;
let movieSearchVersion = 0;
let movieDetailVersion = 0;

function posterUrl(path, size = "w342") {
  return typeof path === "string" && path.startsWith("/")
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : null;
}

function makePoster(path, title, size = "w342") {
  const url = posterUrl(path, size);
  if (!url) {
    const placeholder = document.createElement("div");
    placeholder.className = "poster-placeholder";
    placeholder.setAttribute("aria-label", "No poster available");
    placeholder.textContent = "No poster";
    return placeholder;
  }

  const image = document.createElement("img");
  image.className = "movie-poster";
  image.src = url;
  image.alt = `${title} poster`;
  image.loading = "lazy";
  image.addEventListener("error", () => image.remove());
  return image;
}

function movieYear(movie) {
  return typeof movie.release_date === "string" && movie.release_date.length >= 4
    ? movie.release_date.slice(0, 4)
    : "Release year unknown";
}

function renderMovieResults(movies) {
  movieResults.replaceChildren();

  for (const movie of movies) {
    const card = document.createElement("article");
    card.className = "movie-result";
    card.append(makePoster(movie.poster_path, movie.title));

    const info = document.createElement("div");
    info.className = "movie-result-info";
    const title = document.createElement("h3");
    title.textContent = movie.title;
    const year = document.createElement("p");
    year.className = "field-help";
    year.textContent = movieYear(movie);
    const overview = document.createElement("p");
    overview.className = "movie-overview-preview";
    overview.textContent = movie.overview || "No overview is available.";
    const detailsButton = document.createElement("button");
    detailsButton.type = "button";
    detailsButton.textContent = "View details";
    detailsButton.addEventListener("click", () => void loadMovieDetails(movie.id));

    info.append(title, year, overview, detailsButton);
    card.append(info);
    movieResults.append(card);
  }
}

async function loadMovieDetails(movieId) {
  const requestVersion = ++movieDetailVersion;
  const userId = activeUserId;
  movieDetail.hidden = false;
  movieDetailContent.textContent = "Loading movie details...";

  const { data, error } = await supabase.functions.invoke("tmdb-search", {
    body: { action: "details", movieId },
  });

  if (requestVersion !== movieDetailVersion || userId !== activeUserId) return;
  if (error) {
    movieDetailContent.textContent = `Could not load movie details: ${error.message}`;
    return;
  }

  const movie = data?.movie;
  if (!movie) {
    movieDetailContent.textContent = "No movie details were returned.";
    return;
  }

  const layout = document.createElement("div");
  layout.className = "movie-detail-layout";
  layout.append(makePoster(movie.poster_path, movie.title, "w500"));

  const info = document.createElement("div");
  const title = document.createElement("h3");
  title.id = "movie-detail-heading";
  title.textContent = movie.title;
  const facts = document.createElement("p");
  facts.className = "field-help";
  const details = [movieYear(movie)];
  if (movie.runtime) details.push(`${movie.runtime} minutes`);
  if (typeof movie.vote_average === "number" && movie.vote_average > 0) {
    details.push(`TMDB rating ${movie.vote_average.toFixed(1)}/10`);
  }
  facts.textContent = details.join(" · ");

  const overview = document.createElement("p");
  overview.textContent = movie.overview || "No overview is available.";
  info.append(title, facts);
  if (movie.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "movie-tagline";
    tagline.textContent = movie.tagline;
    info.append(tagline);
  }
  if (Array.isArray(movie.genres) && movie.genres.length) {
    const genres = document.createElement("p");
    genres.className = "field-help";
    genres.textContent = movie.genres.join(" · ");
    info.append(genres);
  }
  info.append(overview);
  layout.append(info);
  movieDetailContent.replaceChildren(layout);
});

async function updateAuthUi(session) {
  const loadVersion = ++profileLoadVersion;
  const user = session?.user ?? null;
  movieSearchVersion += 1;
  movieDetailVersion += 1;
  activeUserId = user?.id ?? null;

  loginForm.hidden = Boolean(user);
  profileSection.hidden = !user;
  movieSearchSection.hidden = !user;
  movieSearchButton.disabled = false;

  if (!user) {
    loginForm.reset();
    profileForm.reset();
    movieResults.replaceChildren();
    movieDetail.hidden = true;
    movieDetailContent.replaceChildren();
    status.textContent = "You are signed out.";
    profileStatus.textContent = "";
    movieSearchStatus.textContent = "";
    return;
  }

  status.textContent = `Signed in as ${user.email ?? "your account"}.`;
  profileStatus.textContent = "Loading your profile…";
  displayNameInput.disabled = true;
  saveProfileButton.disabled = true;

  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadVersion !== profileLoadVersion || activeUserId !== user.id) return;

  displayNameInput.disabled = false;
  saveProfileButton.disabled = false;

  if (error) {
    profileStatus.textContent = `Could not load your profile: ${error.message}`;
    return;
  }

  displayNameInput.value = data?.display_name ?? "";
  profileStatus.textContent = data?.display_name
    ? "Your profile is ready."
    : "Choose a display name to finish setting up your profile.";
}

const {
  data: { session },
} = await supabase.auth.getSession();
await updateAuthUi(session);

supabase.auth.onAuthStateChange((_event, updatedSession) => {
  // Let the auth callback finish before making another Supabase request.
  window.setTimeout(() => void updateAuthUi(updatedSession), 0);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "Sending sign-in link…";

  const { error } = await supabase.auth.signInWithOtp({
    email: emailInput.value.trim(),
    options: {
      emailRedirectTo: window.location.href.split(/[?#]/)[0],
    },
  });

  status.textContent = error
    ? `Could not send the link: ${error.message}`
    : "Check your email for the sign-in link.";
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!activeUserId) {
    profileStatus.textContent = "Sign in again before saving your profile.";
    return;
  }

  const displayName = displayNameInput.value.trim();
  if (displayName.length < 2 || displayName.length > 40) {
    profileStatus.textContent = "Your display name must be 2–40 characters.";
    return;
  }

  saveProfileButton.disabled = true;
  profileStatus.textContent = "Saving your profile…";

  const { error } = await supabase
    .from("profiles")
    .upsert(
      { user_id: activeUserId, display_name: displayName },
      { onConflict: "user_id" },
    );

  saveProfileButton.disabled = false;

  if (error?.code === "23505") {
    profileStatus.textContent = "That display name is already in use. Try another.";
  } else if (error) {
    profileStatus.textContent = `Could not save your profile: ${error.message}`;
  } else {
    profileStatus.textContent = "Display name saved. Friends can now find you.";
  }
});

movieSearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = movieQueryInput.value.trim();
  if (query.length < 2 || query.length > 100) {
    movieSearchStatus.textContent = "Enter a movie title between 2 and 100 characters.";
    return;
  }

  const requestVersion = ++movieSearchVersion;
  const userId = activeUserId;
  movieSearchButton.disabled = true;
  movieSearchStatus.textContent = "Searching TMDB...";
  movieResults.replaceChildren();
  movieDetailVersion += 1;
  movieDetail.hidden = true;

  const { data, error } = await supabase.functions.invoke("tmdb-search", {
    body: { action: "search", query },
  });

  if (requestVersion !== movieSearchVersion || userId !== activeUserId) return;
  movieSearchButton.disabled = false;

  if (error) {
    movieSearchStatus.textContent = `Could not search movies: ${error.message}`;
    return;
  }

  const results = Array.isArray(data?.results) ? data.results : [];
  renderMovieResults(results);
  movieSearchStatus.textContent = results.length
    ? `Found ${results.length} movies.`
    : "No movies found. Try a different title.";
});

closeMovieDetailButton.addEventListener("click", () => {
  movieDetailVersion += 1;
  movieDetail.hidden = true;
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  const { error } = await supabase.auth.signOut();
  signOutButton.disabled = false;
  if (error) status.textContent = `Could not sign out: ${error.message}`;
});
