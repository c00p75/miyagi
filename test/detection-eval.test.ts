/**
 * Detection, measured.
 *
 * The unit tests in `concepts.test.ts` pin individual patterns. This suite
 * asks the question those cannot: over code that looks like what an assistant
 * actually writes, how often is the pack right? Each case is a snippet, the
 * file it would live in, and *every* concept a careful reader would say it
 * relies on. Anything detected beyond that list is a false claim; anything on
 * the list that is missed is a lesson that never happens.
 *
 * Precision is held higher than recall on purpose. A missed idea costs one
 * lesson. A claimed idea that is not there teaches the reader that the tutor
 * makes things up, and after that nothing it says is read.
 *
 * The corpus is the specification. When a realistic case fails, the fix is to
 * the pattern in `src/concepts.ts`, not to the case. Two things are left out
 * deliberately, because a line-by-line regular expression cannot see them:
 * prose inside a code comment that happens to use a keyword ("await the
 * result"), and code spread over several lines where no single line carries
 * the signal.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CONCEPTS, detectConcepts } from "../src/concepts.js";

interface Case {
  name: string;
  file: string;
  code: string;
  /** Every concept this snippet really relies on. A hit outside this list is a false positive. */
  expect: string[];
  /** The tempting wrong answers, named so a failure says which trap was fallen into. */
  forbid?: string[];
}

const L = (...lines: string[]) => lines.join("\n");

// Assembled at runtime so the repository never contains a string that a
// secret scanner (or this pack) would take for a live credential.
const FAKE = "a1B2c3D4e5F6g7H8i9J0k1L2";

const POSITIVES: Case[] = [
  /* ---- hardcoded-secret ---- */
  { name: "secret: stripe key in a client constructor", file: "lib/pay.ts", code: `const stripe = new Stripe("sk_live_${FAKE}");`, expect: ["hardcoded-secret"] },
  { name: "secret: api key constant in python settings", file: "settings.py", code: `API_KEY = "${FAKE}"`, expect: ["hardcoded-secret"] },
  { name: "secret: github token in a committed env file", file: ".env.production", code: `GITHUB_TOKEN=ghp_${FAKE}`, expect: ["hardcoded-secret"] },

  /* ---- sql-interpolation ---- */
  { name: "sql: template literal", file: "lib/orders.ts", code: "const rows = await db.query(`SELECT * FROM orders WHERE user_id = ${userId}`);", expect: ["sql-interpolation", "async-await"] },
  { name: "sql: python percent formatting inside sql quotes", file: "repo.py", code: `cur.execute("SELECT * FROM users WHERE email = '%s'" % email)`, expect: ["sql-interpolation"] },
  { name: "sql: php dot concatenation", file: "user.php", code: `$result = mysqli_query($conn, "SELECT * FROM users WHERE id = " . $_GET['id']);`, expect: ["sql-interpolation"] },
  { name: "sql: go concatenation with an sql quote", file: "store.go", code: `rows, err := db.Query("SELECT * FROM users WHERE name = '" + name + "'")`, expect: ["sql-interpolation"] },

  /* ---- password-hashing ---- */
  { name: "hashing: bcrypt in node", file: "auth.ts", code: "const hash = await bcrypt.hash(password, 12);", expect: ["password-hashing", "async-await"] },
  { name: "hashing: bcrypt in python", file: "auth.py", code: "hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())", expect: ["password-hashing"] },
  { name: "hashing: php password_hash", file: "register.php", code: "$hash = password_hash($password, PASSWORD_ARGON2ID);", expect: ["password-hashing"] },

  /* ---- auth-token ---- */
  { name: "token: jwt signed from an env secret", file: "auth.ts", code: `const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: "15m" });`, expect: ["auth-token", "env-vars"] },
  { name: "token: pyjwt decode", file: "deps.py", code: `payload = jwt.decode(token, SECRET, algorithms=["HS256"])`, expect: ["auth-token"] },
  { name: "token: session cookie in express", file: "login.js", code: `res.cookie("session", sid, { httpOnly: true, secure: true, sameSite: "lax" });`, expect: ["auth-token"] },
  { name: "token: bearer header", file: "api.ts", code: "  headers: { Authorization: `Bearer ${token}` },", expect: ["auth-token"] },

  /* ---- input-validation ---- */
  { name: "validation: zod schema", file: "schema.ts", code: "const Body = z.object({ email: z.string().email(), age: z.number().int() });", expect: ["input-validation"] },
  { name: "validation: pydantic model", file: "models.py", code: "class SignupRequest(BaseModel):", expect: ["input-validation"] },
  { name: "validation: safeParse on a request body", file: "route.ts", code: "const parsed = schema.safeParse(await req.json());", expect: ["input-validation", "async-await"] },

  /* ---- env-vars ---- */
  { name: "env: node", file: "lib/db.ts", code: "const url = process.env.DATABASE_URL;", expect: ["env-vars"] },
  { name: "env: python", file: "settings.py", code: `DEBUG = os.environ.get("DEBUG", "0") == "1"`, expect: ["env-vars"] },
  { name: "env: ruby", file: "config/initializers/redis.rb", code: `REDIS = Redis.new(url: ENV["REDIS_URL"])`, expect: ["env-vars"] },

  /* ---- cors ---- */
  { name: "cors: express middleware", file: "server.js", code: `app.use(cors({ origin: "https://app.example.com", credentials: true }));`, expect: ["cors"] },
  { name: "cors: fastapi middleware", file: "main.py", code: `app.add_middleware(CORSMiddleware, allow_origins=["*"])`, expect: ["cors"] },
  { name: "cors: go header", file: "handler.go", code: `w.Header().Set("Access-Control-Allow-Origin", "*")`, expect: ["cors"] },

  /* ---- client-server-boundary ---- */
  { name: "boundary: use client", file: "app/cart.tsx", code: `"use client";`, expect: ["client-server-boundary"] },
  { name: "boundary: use server", file: "app/actions.ts", code: `"use server";`, expect: ["client-server-boundary"] },
  { name: "boundary: getServerSideProps", file: "pages/index.js", code: "export async function getServerSideProps(ctx) {", expect: ["client-server-boundary", "async-await"] },

  /* ---- db-schema ---- */
  { name: "schema: sql migration", file: "migrations/001_orders.sql", code: "CREATE TABLE orders (id SERIAL PRIMARY KEY, total_cents INTEGER NOT NULL);", expect: ["db-schema"] },
  { name: "schema: prisma model", file: "prisma/schema.prisma", code: "model Post {", expect: ["db-schema"] },
  { name: "schema: alembic migration", file: "versions/9f1_add_plan.py", code: `    op.add_column("users", sa.Column("plan", sa.String(), nullable=True))`, expect: ["db-schema"] },
  { name: "schema: drizzle table", file: "db/schema.ts", code: `export const users = pgTable("users", {`, expect: ["db-schema"] },

  /* ---- api-route ---- */
  { name: "route: next route handler", file: "app/api/health/route.ts", code: "export async function GET(request: Request) {", expect: ["api-route", "async-await"] },
  { name: "route: express", file: "server.js", code: `app.get("/api/users/:id", async (req, res) => {`, expect: ["api-route", "async-await"] },
  { name: "route: fastapi decorator", file: "main.py", code: `@app.get("/items/{item_id}")`, expect: ["api-route"] },
  { name: "route: status code on the response", file: "users.js", code: `    return res.status(404).json({ error: "Not found" });`, expect: ["api-route"] },

  /* ---- react-effect ---- */
  { name: "effect: with dependencies", file: "Title.tsx", code: "useEffect(() => { document.title = title; }, [title]);", expect: ["react-effect"] },
  { name: "effect: layout effect", file: "Tooltip.jsx", code: "  useLayoutEffect(() => {", expect: ["react-effect"] },

  /* ---- error-handling ---- */
  { name: "errors: js catch", file: "save.ts", code: "  } catch (err) {", expect: ["error-handling"] },
  { name: "errors: python except", file: "parse.py", code: "    except ValueError as exc:", expect: ["error-handling"] },
  { name: "errors: python raise", file: "views.py", code: `        raise HTTPException(status_code=404, detail="Not found")`, expect: ["error-handling"] },
  { name: "errors: js throw", file: "orders.js", code: `throw new Error("Order not found");`, expect: ["error-handling"] },
  { name: "errors: java catch", file: "Loader.java", code: "        } catch (IOException e) {", expect: ["error-handling"] },

  /* ---- browser-storage ---- */
  { name: "storage: localStorage write", file: "theme.ts", code: `localStorage.setItem("theme", theme);`, expect: ["browser-storage"] },
  { name: "storage: sessionStorage read", file: "draft.js", code: `const draft = sessionStorage.getItem("draft");`, expect: ["browser-storage"] },

  /* ---- react-state ---- */
  { name: "state: useState", file: "Menu.tsx", code: "const [open, setOpen] = useState(false);", expect: ["react-state"] },
  { name: "state: useState with a type argument", file: "Profile.tsx", code: "const [user, setUser] = useState<User | null>(null);", expect: ["react-state"] },
  { name: "state: useReducer", file: "Cart.jsx", code: "const [state, dispatch] = useReducer(reducer, initialState);", expect: ["react-state"] },

  /* ---- async-await ---- */
  { name: "async: Promise.all", file: "load.ts", code: "const [user, posts] = await Promise.all([getUser(id), getPosts(id)]);", expect: ["async-await"] },
  { name: "async: python coroutine", file: "profile.py", code: "async def load_profile(user_id: int):", expect: ["async-await"] },
  { name: "async: rust postfix await", file: "client.rs", code: "let body = client.get(url).send().await?;", expect: ["async-await"] },

  /* ---- dependency-added ---- */
  { name: "deps: package.json", file: "package.json", code: `    "stripe": "^14.21.0",`, expect: ["dependency-added"] },
  { name: "deps: requirements.txt", file: "requirements.txt", code: "fastapi==0.110.0", expect: ["dependency-added"] },
  { name: "deps: Cargo.toml", file: "Cargo.toml", code: `serde = "1.0"`, expect: ["dependency-added"] },
  { name: "deps: Gemfile", file: "Gemfile", code: `gem "sidekiq"`, expect: ["dependency-added"] },
  { name: "deps: go.mod", file: "go.mod", code: "\tgithub.com/gin-gonic/gin v1.9.1", expect: ["dependency-added"] },

  /* ---- orm-query ---- */
  { name: "orm: prisma findMany", file: "posts.ts", code: "const posts = await prisma.post.findMany({ where: { authorId }, include: { author: true } });", expect: ["orm-query", "async-await"] },
  { name: "orm: django queryset", file: "views.py", code: "orders = Order.objects.filter(user=request.user)", expect: ["orm-query"] },
  { name: "orm: supabase", file: "todos.ts", code: `const { data } = await supabase.from("todos").select("*");`, expect: ["orm-query", "async-await"] },
  { name: "orm: drizzle select", file: "users.ts", code: "const rows = await db.select().from(users).where(eq(users.id, id));", expect: ["orm-query", "async-await"] },

  /* ---- http-fetch ---- */
  { name: "http: fetch", file: "items.ts", code: `const res = await fetch("https://api.example.com/v1/items");`, expect: ["http-fetch", "async-await"] },
  { name: "http: python requests", file: "client.py", code: "resp = requests.get(url, timeout=10)", expect: ["http-fetch"] },
  { name: "http: axios", file: "login.js", code: `const { data } = await axios.post("/api/login", credentials);`, expect: ["http-fetch", "async-await"] },

  /* ---- tests ---- */
  { name: "tests: jest", file: "add.test.ts", code: L(`test("adds two numbers", () => {`, "  expect(add(1, 2)).toBe(3);", "});"), expect: ["tests"] },
  { name: "tests: pytest", file: "test_payments.py", code: "def test_refund_is_idempotent():", expect: ["tests"] },
  { name: "tests: node assert", file: "slug.test.js", code: `assert.equal(slugify("Hello World"), "hello-world");`, expect: ["tests"] },

  /* ---- gitignore ---- */
  { name: "gitignore: root", file: ".gitignore", code: L(".env", "node_modules/"), expect: ["gitignore"] },
  { name: "gitignore: nested", file: "apps/web/.gitignore", code: "dist/", expect: ["gitignore"] },

  /* ---- type-escape ---- */
  { name: "types: as any", file: "load.ts", code: "const data = (await res.json()) as any;", expect: ["type-escape", "async-await"] },
  { name: "types: ts-ignore", file: "legacy.ts", code: "// @ts-ignore", expect: ["type-escape"] },
  { name: "types: any parameter", file: "handler.ts", code: "function handle(event: any) {", expect: ["type-escape"] },

  /* ---- container-image ---- */
  { name: "container: Dockerfile", file: "Dockerfile", code: L("FROM python:3.12-slim", "COPY . ."), expect: ["container-image"] },
  { name: "container: compose file", file: "docker-compose.yml", code: L("    image: postgres:16", "    ports:"), expect: ["container-image"] },

  /* ---- css-layout ---- */
  { name: "layout: css grid", file: "styles.css", code: "  display: grid;", expect: ["css-layout"] },
  { name: "layout: tailwind flex", file: "Row.tsx", code: `<div className="flex items-center gap-2">`, expect: ["css-layout"] },
  { name: "layout: tailwind grid in vue", file: "Grid.vue", code: `<div class="grid grid-cols-3 gap-4">`, expect: ["css-layout"] },

  /* ---- xss-html-injection ---- */
  { name: "xss: dangerouslySetInnerHTML", file: "Post.tsx", code: "<div dangerouslySetInnerHTML={{ __html: post.body }} />", expect: ["xss-html-injection"] },
  { name: "xss: innerHTML assignment", file: "comments.js", code: `el.innerHTML = "<li>" + comment.text + "</li>";`, expect: ["xss-html-injection"] },
  { name: "xss: v-html", file: "Comment.vue", code: `<p v-html="comment.body"></p>`, expect: ["xss-html-injection"] },
  { name: "xss: jinja safe filter", file: "templates/profile.html", code: `<div class="bio">{{ user.bio|safe }}</div>`, expect: ["xss-html-injection"] },
  { name: "xss: django mark_safe", file: "templatetags/fmt.py", code: `    return mark_safe(f"<b>{name}</b>")`, expect: ["xss-html-injection"] },
  { name: "xss: svelte html tag", file: "Article.svelte", code: "{@html article.content}", expect: ["xss-html-injection"] },

  /* ---- rate-limiting ---- */
  { name: "rate: express-rate-limit", file: "server.js", code: "const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });", expect: ["rate-limiting"] },
  { name: "rate: upstash import", file: "lib/limit.ts", code: `import { Ratelimit } from "@upstash/ratelimit";`, expect: ["rate-limiting"] },
  { name: "rate: slowapi decorator", file: "main.py", code: `@limiter.limit("5/minute")`, expect: ["rate-limiting"] },
  { name: "rate: drf throttle classes", file: "views.py", code: "    throttle_classes = [UserRateThrottle]", expect: ["rate-limiting"] },
  { name: "rate: laravel throttle middleware", file: "routes/api.php", code: `Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');`, expect: ["rate-limiting"] },
  { name: "rate: a hand-written 429", file: "limit.js", code: `    return res.status(429).set("Retry-After", "60").send("Too many requests");`, expect: ["rate-limiting", "api-route"] },

  /* ---- db-transaction ---- */
  { name: "tx: prisma interactive transaction", file: "transfer.ts", code: "await prisma.$transaction(async (tx) => {", expect: ["db-transaction", "async-await"] },
  { name: "tx: django atomic block", file: "services.py", code: "    with transaction.atomic():", expect: ["db-transaction"] },
  { name: "tx: plain sql", file: "transfer.sql", code: L("BEGIN;", "UPDATE accounts SET balance = balance - 100 WHERE id = 1;", "COMMIT;"), expect: ["db-transaction"] },
  { name: "tx: node-postgres BEGIN", file: "transfer.js", code: `await client.query("BEGIN");`, expect: ["db-transaction", "async-await"] },
  { name: "tx: spring annotation", file: "TransferService.java", code: L("    @Transactional", "    public void transfer(Long from, Long to, BigDecimal amount) {"), expect: ["db-transaction"] },
  { name: "tx: go BeginTx", file: "store.go", code: "tx, err := db.BeginTx(ctx, nil)", expect: ["db-transaction"] },
  { name: "tx: sqlalchemy commit", file: "repo.py", code: "    session.commit()", expect: ["db-transaction"] },

  /* ---- caching ---- */
  { name: "cache: redis set with expiry", file: "users.ts", code: "await redis.set(`user:${id}`, JSON.stringify(user), \"EX\", 60);", expect: ["caching", "async-await"] },
  { name: "cache: python lru_cache", file: "rates.py", code: "@lru_cache(maxsize=256)", expect: ["caching"] },
  { name: "cache: next revalidate export", file: "app/blog/page.tsx", code: "export const revalidate = 3600;", expect: ["caching"] },
  { name: "cache: Cache-Control header", file: "assets.js", code: `res.setHeader("Cache-Control", "public, max-age=300");`, expect: ["caching"] },
  { name: "cache: django cache.set", file: "profile.py", code: `cache.set(f"profile:{user_id}", profile, timeout=300)`, expect: ["caching"] },
  { name: "cache: next unstable_cache", file: "lib/data.ts", code: `const getUser = unstable_cache(async (id) => loadUser(id), ["user"], { revalidate: 60 });`, expect: ["caching", "async-await"] },
  { name: "cache: spring Cacheable", file: "ProductService.java", code: `    @Cacheable("products")`, expect: ["caching"] },

  /* ---- pagination ---- */
  { name: "paging: limit and offset placeholders", file: "posts.ts", code: `const rows = await sql("SELECT * FROM posts ORDER BY id LIMIT $1 OFFSET $2", [limit, offset]);`, expect: ["pagination", "async-await"] },
  { name: "paging: prisma skip and take", file: "posts.ts", code: "const posts = await prisma.post.findMany({ skip: (page - 1) * pageSize, take: pageSize });", expect: ["pagination", "orm-query", "async-await"] },
  { name: "paging: flask page parameter", file: "views.py", code: `page = int(request.args.get("page", 1))`, expect: ["pagination"] },
  { name: "paging: cursor from the query string", file: "route.ts", code: `const cursor = searchParams.get("cursor");`, expect: ["pagination"] },
  { name: "paging: drf pagination class", file: "pagination.py", code: "class StandardPagination(PageNumberPagination):", expect: ["pagination"] },
  { name: "paging: next cursor in a response", file: "feed.ts", code: "return { items, nextCursor: items.at(-1)?.id ?? null };", expect: ["pagination"] },
  { name: "paging: mongoose skip and limit", file: "docs.js", code: "const docs = await Doc.find().skip(offset).limit(20);", expect: ["pagination", "async-await"] },

  /* ---- file-upload ---- */
  { name: "upload: multer", file: "upload.js", code: `const upload = multer({ dest: "uploads/", limits: { fileSize: 5_000_000 } });`, expect: ["file-upload"] },
  { name: "upload: fastapi UploadFile", file: "main.py", code: "async def upload_avatar(file: UploadFile):", expect: ["file-upload", "async-await"] },
  { name: "upload: file input", file: "AvatarForm.tsx", code: `<input type="file" accept="image/png" onChange={onPick} />`, expect: ["file-upload"] },
  { name: "upload: File from form data", file: "actions.ts", code: `const file = formData.get("file") as File;`, expect: ["file-upload"] },
  { name: "upload: flask request.files", file: "views.py", code: `f = request.files["document"]`, expect: ["file-upload"] },
  { name: "upload: s3 put for a presigned url", file: "presign.ts", code: "const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type });", expect: ["file-upload"] },
  { name: "upload: multipart html form", file: "upload.html", code: `<form method="post" enctype="multipart/form-data">`, expect: ["file-upload"] },

  /* ---- webhook ---- */
  { name: "webhook: stripe constructEvent", file: "route.ts", code: "const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);", expect: ["webhook", "env-vars"] },
  { name: "webhook: python handler", file: "views.py", code: "def stripe_webhook(request):", expect: ["webhook"] },
  { name: "webhook: github signature header", file: "github.js", code: `const signature = req.headers["x-hub-signature-256"];`, expect: ["webhook"] },
  { name: "webhook: svix verifier", file: "clerk.ts", code: "const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);", expect: ["webhook", "env-vars"] },
  { name: "webhook: express route with a raw body", file: "server.js", code: `app.post("/webhooks/stripe", express.raw({ type: "application/json" }), handler);`, expect: ["webhook", "api-route"] },

  /* ---- react-props ---- */
  { name: "props: props interface", file: "Button.tsx", code: "interface ButtonProps {", expect: ["react-props"] },
  { name: "props: destructured in a function component", file: "Card.tsx", code: "export function Card({ title, children }: CardProps) {", expect: ["react-props"] },
  { name: "props: destructured in an arrow component", file: "Avatar.jsx", code: "const Avatar = ({ src, size = 40 }) => (", expect: ["react-props"] },
  { name: "props: read off the props object", file: "Heading.jsx", code: "  return <h1>{props.title}</h1>;", expect: ["react-props"] },
  { name: "props: vue defineProps", file: "Title.vue", code: "const props = defineProps<{ title: string }>();", expect: ["react-props"] },

  /* ---- background-job ---- */
  { name: "job: node-cron schedule", file: "jobs.js", code: `cron.schedule("0 3 * * *", () => cleanupExpiredSessions());`, expect: ["background-job"] },
  { name: "job: bullmq enqueue", file: "signup.ts", code: `await emailQueue.add("welcome", { userId });`, expect: ["background-job", "async-await"] },
  { name: "job: celery task", file: "tasks.py", code: "@shared_task(bind=True, max_retries=3)", expect: ["background-job"] },
  { name: "job: spring scheduled", file: "Reports.java", code: `    @Scheduled(cron = "0 0 * * * *")`, expect: ["background-job"] },
  { name: "job: inngest function", file: "digest.ts", code: `export const sendDigest = inngest.createFunction({ id: "send-digest" }, { cron: "0 9 * * 1" }, async ({ step }) => {`, expect: ["background-job", "async-await"] },
  { name: "job: interval timer", file: "metrics.js", code: "setInterval(() => flushMetrics(), 60_000);", expect: ["background-job"] },
  { name: "job: rails perform_later", file: "users_controller.rb", code: "    WelcomeEmailJob.perform_later(user.id)", expect: ["background-job"] },
  { name: "job: vercel cron config", file: "vercel.json", code: `  "crons": [{ "path": "/api/cron/digest", "schedule": "0 9 * * *" }]`, expect: ["background-job"] },

  /* ---- the same ideas in other languages and frameworks ---- */
  { name: "secret: aws access key id", file: "deploy.py", code: `AWS_ACCESS_KEY_ID = "AKIA${FAKE.slice(0, 16).toUpperCase()}"`, expect: ["hardcoded-secret"] },
  { name: "secret: password inside a connection string", file: "db.ts", code: `const pool = new Pool({ connectionString: "postgres://admin:${FAKE.slice(0, 10)}@db.internal:5432/app" });`, expect: ["hardcoded-secret"] },
  { name: "env: go", file: "main.go", code: `port := os.Getenv("PORT")`, expect: ["env-vars"] },
  { name: "env: rust", file: "main.rs", code: `let url = env::var("DATABASE_URL")?;`, expect: ["env-vars"] },
  { name: "cors: spring annotation", file: "ApiController.java", code: `@CrossOrigin(origins = "https://app.example.com")`, expect: ["cors"] },
  { name: "schema: django model", file: "models.py", code: "class Order(models.Model):", expect: ["db-schema"] },
  { name: "schema: rails migration", file: "db/migrate/20240101_create_users.rb", code: "    create_table :users do |t|", expect: ["db-schema"] },
  { name: "route: flask blueprint", file: "users.py", code: `@bp.route("/users/<int:user_id>")`, expect: ["api-route"] },
  { name: "route: nestjs decorator", file: "users.controller.ts", code: `  @Get(":id")`, expect: ["api-route"] },
  { name: "route: go net/http", file: "main.go", code: `http.HandleFunc("/health", healthHandler)`, expect: ["api-route"] },
  { name: "route: gin", file: "main.go", code: `r.GET("/ping", func(c *gin.Context) {`, expect: ["api-route"] },
  { name: "route: spring mapping", file: "UserController.java", code: `    @GetMapping("/users/{id}")`, expect: ["api-route"] },
  { name: "errors: go error check", file: "store.go", code: "if err != nil {", expect: ["error-handling"] },
  { name: "errors: ruby rescue", file: "import.rb", code: "rescue ActiveRecord::RecordInvalid => e", expect: ["error-handling"] },
  { name: "errors: promise catch", file: "save.js", code: "save(order).catch((err) => report(err));", expect: ["error-handling"] },
  { name: "deps: poetry caret range", file: "pyproject.toml", code: `fastapi = "^0.110.0"`, expect: ["dependency-added"] },
  { name: "deps: pep 621 list entry", file: "pyproject.toml", code: `    "httpx>=0.27",`, expect: ["dependency-added"] },
  { name: "deps: cargo table form", file: "Cargo.toml", code: `tokio = { version = "1", features = ["full"] }`, expect: ["dependency-added"] },
  { name: "orm: mongoose findOne", file: "users.js", code: "const user = await User.findOne({ email });", expect: ["orm-query", "async-await"] },
  { name: "orm: rails find_by", file: "sessions_controller.rb", code: "    user = User.find_by(email: params[:email])", expect: ["orm-query"] },
  { name: "orm: sqlalchemy session query", file: "repo.py", code: "    return session.query(User).filter(User.email == email).first()", expect: ["orm-query"] },
  { name: "http: httpx", file: "client.py", code: "resp = httpx.get(url, timeout=5.0)", expect: ["http-fetch"] },
  { name: "http: go", file: "client.go", code: "resp, err := http.Get(url)", expect: ["http-fetch"] },
  { name: "tests: go", file: "add_test.go", code: "func TestAdd(t *testing.T) {", expect: ["tests"] },
  { name: "tests: rust", file: "lib.rs", code: "    #[test]", expect: ["tests"] },
  { name: "tests: python unittest", file: "test_cart.py", code: "        self.assertEqual(cart.total(), 300)", expect: ["tests"] },
  { name: "types: any inside a generic", file: "config.ts", code: "const settings: Record<string, any> = {};", expect: ["type-escape"] },
  { name: "layout: flex in a style object", file: "Row.tsx", code: `<div style={{ display: "flex", gap: 8 }}>`, expect: ["css-layout"] },
  { name: "xss: rails raw", file: "show.html.erb", code: "<%= raw @comment.body %>", expect: ["xss-html-injection"] },
  { name: "xss: angular innerHTML binding", file: "comment.component.html", code: `<div [innerHTML]="comment.body"></div>`, expect: ["xss-html-injection"] },
  { name: "xss: jquery html()", file: "comments.js", code: `$("#comments").html(response.html);`, expect: ["xss-html-injection"] },
  { name: "xss: php echo of a request value", file: "search.php", code: "echo $_GET['q'];", expect: ["xss-html-injection"] },
  { name: "xss: handlebars triple stash", file: "post.hbs", code: "<article>{{{post.body}}}</article>", expect: ["xss-html-injection"] },
  { name: "rate: go x/time limiter", file: "limit.go", code: "limiter := rate.NewLimiter(rate.Every(time.Second), 5)", expect: ["rate-limiting"] },
  { name: "rate: rack-attack", file: "config/initializers/rack_attack.rb", code: `Rack::Attack.throttle("logins/ip", limit: 5, period: 20.seconds) do |req|`, expect: ["rate-limiting"] },
  { name: "rate: upstash limit check", file: "route.ts", code: "const { success } = await ratelimit.limit(ip);", expect: ["rate-limiting", "async-await"] },
  { name: "rate: django-ratelimit decorator", file: "views.py", code: `@ratelimit(key="ip", rate="5/m", block=True)`, expect: ["rate-limiting"] },
  { name: "tx: knex", file: "orders.js", code: "await knex.transaction(async (trx) => {", expect: ["db-transaction", "async-await"] },
  { name: "tx: rails", file: "transfer.rb", code: "ActiveRecord::Base.transaction do", expect: ["db-transaction"] },
  { name: "tx: laravel", file: "TransferController.php", code: "DB::transaction(function () use ($from, $to) {", expect: ["db-transaction"] },
  { name: "tx: sqlalchemy begin block", file: "repo.py", code: "    with Session.begin() as session:", expect: ["db-transaction"] },
  { name: "cache: laravel remember", file: "UserController.php", code: "$users = Cache::remember('users', 600, fn () => User::all());", expect: ["caching"] },
  { name: "cache: rails cache fetch", file: "products_controller.rb", code: `    @products = Rails.cache.fetch("products", expires_in: 5.minutes) do`, expect: ["caching"] },
  { name: "cache: fetch opting out", file: "page.tsx", code: `const res = await fetch(url, { cache: "no-store" });`, expect: ["caching", "http-fetch", "async-await"] },
  { name: "cache: django cache_page", file: "views.py", code: "@cache_page(60 * 15)", expect: ["caching"] },
  { name: "paging: laravel paginate", file: "PostController.php", code: "$posts = Post::orderBy('id')->paginate(15);", expect: ["pagination"] },
  { name: "paging: rails kaminari", file: "posts_controller.rb", code: "    @posts = Post.order(:id).page(params[:page]).per(20)", expect: ["pagination"] },
  { name: "paging: spring pageable", file: "PostController.java", code: "    public Page<Post> list(Pageable pageable) {", expect: ["pagination"] },
  { name: "paging: lower-case sql", file: "posts.sql", code: "select id, title from posts order by id limit 20 offset 40;", expect: ["pagination"] },
  { name: "upload: go FormFile", file: "upload.go", code: `file, header, err := r.FormFile("avatar")`, expect: ["file-upload"] },
  { name: "upload: laravel request file", file: "AvatarController.php", code: "$path = $request->file('avatar')->store('avatars');", expect: ["file-upload"] },
  { name: "upload: rails active storage", file: "user.rb", code: "  has_one_attached :avatar", expect: ["file-upload"] },
  { name: "upload: picked file in a change handler", file: "Picker.tsx", code: "const picked = event.target.files?.[0];", expect: ["file-upload"] },
  { name: "webhook: stripe in python", file: "views.py", code: "    event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)", expect: ["webhook"] },
  { name: "webhook: go handler", file: "hooks.go", code: "func handleGithubWebhook(w http.ResponseWriter, r *http.Request) {", expect: ["webhook"] },
  { name: "webhook: flask route", file: "app.py", code: `@app.route("/webhook", methods=["POST"])`, expect: ["webhook", "api-route"] },
  { name: "props: class component", file: "Legacy.jsx", code: "    return <li>{this.props.label}</li>;", expect: ["react-props"] },
  { name: "props: typed children", file: "Layout.tsx", code: "export default function Layout({ children }: { children: React.ReactNode }) {", expect: ["react-props"] },
  { name: "props: svelte 5 runes", file: "Title.svelte", code: "let { title, subtitle } = $props();", expect: ["react-props"] },
  { name: "job: apscheduler", file: "scheduler.py", code: `scheduler.add_job(send_digest, "cron", hour=9)`, expect: ["background-job"] },
  { name: "job: laravel dispatch", file: "OrderController.php", code: "SendReceipt::dispatch($order);", expect: ["background-job"] },
  { name: "job: celery apply_async", file: "views.py", code: "    send_welcome.apply_async(args=[user.id], countdown=60)", expect: ["background-job"] },
  { name: "job: fastapi background task", file: "main.py", code: "    background_tasks.add_task(send_email, user.email)", expect: ["background-job"] },
];

/** Snippets that look like a concept and are not. Each must produce no hit for what it forbids. */
const NEGATIVES: Case[] = [
  { name: "not anything: a readme that names every idea", file: "README.md", code: "We cache pages, paginate results, rate limit logins, run a cron job and verify the webhook signature in a transaction.", expect: [], forbid: ["caching", "pagination", "rate-limiting", "background-job", "webhook", "db-transaction"] },
  { name: "not react: a fenced example in docs", file: "docs/state.md", code: L("```tsx", "const [n, setN] = useState(0);", "```"), expect: [], forbid: ["react-state"] },
  { name: "not react: a hook name in python", file: "a.py", code: "useState(0)", expect: [], forbid: ["react-state"] },
  { name: "not paging: the word page in a comment", file: "list.ts", code: "// TODO: add pagination to this page once the list gets long", expect: [], forbid: ["pagination"] },
  { name: "not paging: the word page in jsx text", file: "Footer.tsx", code: "<p>Go to the next page to see more results</p>", expect: [], forbid: ["pagination"] },
  { name: "not paging: a puppeteer page", file: "scrape.ts", code: "const page = await browser.newPage();", expect: ["async-await"], forbid: ["pagination"] },
  { name: "not paging: a database cursor object", file: "db.py", code: "cursor = conn.cursor()", expect: [], forbid: ["pagination", "db-transaction"] },
  { name: "not paging: the css cursor property", file: "Save.tsx", code: `<button style={{ cursor: "pointer" }}>Save</button>`, expect: [], forbid: ["pagination", "react-props"] },
  { name: "not paging: indexing into a list of pages", file: "book.js", code: "const page = pages[index];", expect: [], forbid: ["pagination"] },
  { name: "not paging or limiting: a variable called limit", file: "trim.ts", code: "const limit = Math.min(input.length, 10);", expect: [], forbid: ["pagination", "rate-limiting"] },
  { name: "not caching: a variable called cached", file: "totals.ts", code: L("const cached = computeTotals(orders);", "if (cached) return cached;"), expect: [], forbid: ["caching"] },
  { name: "not caching: the word in a page title", file: "settings.js", code: `export const metadata = { title: "Cache settings" };`, expect: [], forbid: ["caching"] },
  { name: "not props: a function taking an options object", file: "users.ts", code: "function createUser({ name, email }: NewUser) {", expect: [], forbid: ["react-props"] },
  { name: "not props: a lower-case arrow with a destructured argument", file: "retry.ts", code: "const withRetries = ({ retries = 3 } = {}) => retries;", expect: [], forbid: ["react-props"] },
  { name: "not props: children of a tree node", file: "tree.ts", code: "const { children } = node;", expect: [], forbid: ["react-props"] },
  { name: "not props: an object that happens to be called props", file: "track.js", code: `analytics.track("signup", props);`, expect: [], forbid: ["react-props"] },
  { name: "not xss: emptying an element", file: "list.js", code: `el.innerHTML = "";`, expect: [], forbid: ["xss-html-injection"] },
  { name: "not xss: text set as text", file: "list.js", code: "el.textContent = comment.text;", expect: [], forbid: ["xss-html-injection"] },
  { name: "not xss: comparing innerHTML", file: "list.js", code: `if (el.innerHTML === "") return;`, expect: [], forbid: ["xss-html-injection"] },
  { name: "not xss: an ordinary script tag", file: "index.html", code: `<script src="/app.js"></script>`, expect: [], forbid: ["xss-html-injection"] },
  { name: "not a webhook: an outgoing slack url", file: "notify.js", code: `const webhookUrl = "https://hooks.slack.com/services/T000/B000/XXXX";`, expect: [], forbid: ["webhook", "hardcoded-secret"] },
  { name: "not a transaction: git commit as an argument", file: "release.js", code: `await run("git", ["commit", "-m", message]);`, expect: ["async-await"], forbid: ["db-transaction"] },
  { name: "not a transaction: ruby begin and rescue", file: "import.rb", code: L("begin", "  import!(row)", "rescue StandardError => e"), expect: ["error-handling"], forbid: ["db-transaction"] },
  { name: "not a transaction: a field with the word in it", file: "pay.py", code: `transaction_id = payment["id"]`, expect: [], forbid: ["db-transaction"] },
  { name: "not a job: a one-off timeout", file: "Toast.tsx", code: "const timer = setTimeout(() => setOpen(false), 3000);", expect: [], forbid: ["background-job"] },
  { name: "not a job: an in-memory queue for a tree walk", file: "bfs.js", code: L("const queue = [root];", "queue.push(node.left);"), expect: [], forbid: ["background-job"] },
  { name: "not a job: a variable called schedule", file: "plan.py", code: "schedule = load_schedule(path)", expect: [], forbid: ["background-job"] },
  { name: "not an upload: reading a file from disk", file: "config.ts", code: `const text = await fs.readFile(file, "utf8");`, expect: ["async-await"], forbid: ["file-upload"] },
  { name: "not an upload: a text input", file: "Form.tsx", code: `<input type="text" name="email" />`, expect: [], forbid: ["file-upload"] },
  { name: "not an upload: a text field from form data", file: "actions.ts", code: `const name = formData.get("name");`, expect: [], forbid: ["file-upload"] },
  { name: "not injection: a parameterised query", file: "q.ts", code: `db.query("SELECT * FROM users WHERE id = $1", [id])`, expect: [], forbid: ["sql-interpolation"] },
  { name: "not injection: python parameters passed separately", file: "q.py", code: `cur.execute("SELECT * FROM users WHERE email = %s", (email,))`, expect: [], forbid: ["sql-interpolation"] },
  { name: "not a secret: a key read from the environment", file: "pay.ts", code: "const apiKey = process.env.STRIPE_KEY;", expect: ["env-vars"], forbid: ["hardcoded-secret"] },
  { name: "not a dependency: the package's own version", file: "package.json", code: L(`  "name": "my-app",`, `  "version": "1.4.0",`), expect: [], forbid: ["dependency-added"] },
  { name: "not a dependency: a crate's own version", file: "Cargo.toml", code: L("[package]", `version = "0.3.1"`), expect: [], forbid: ["dependency-added"] },
  { name: "not a type escape: unknown is the honest one", file: "api.ts", code: "type Result = { data: unknown };", expect: [], forbid: ["type-escape"] },
  { name: "not a secret: a connection string built from variables", file: "db.ts", code: "const url = `postgres://${user}:${password}@${host}/app`;", expect: [], forbid: ["hardcoded-secret"] },
  { name: "not a secret: a url with a port and an email in the query", file: "invite.ts", code: `const link = "https://example.com:8443/invite?to=sam@example.com";`, expect: [], forbid: ["hardcoded-secret"] },
  { name: "not xss: jquery html() used as a getter", file: "copy.js", code: `const markup = $("#template").html();`, expect: [], forbid: ["xss-html-injection"] },
  { name: "not an orm call: a lower-case array helper", file: "pick.js", code: "const admin = users.find((u) => u.role === \"admin\");", expect: [], forbid: ["orm-query"] },
  { name: "not a route: a map lookup", file: "lookup.go", code: `value := cache.Get("user")`, expect: [], forbid: ["api-route", "caching"] },
  { name: "not a test: a function that merely starts with test", file: "probe.py", code: "def testimonial_for(user):", expect: [], forbid: ["tests"] },
];

/** Real changes touch several ideas at once. Every one of them should be seen, and nothing else. */
const MIXED: Case[] = [
  {
    name: "mixed: a next.js create endpoint",
    file: "app/api/users/route.ts",
    code: L(
      "export async function POST(req: Request) {",
      "  const body = schema.safeParse(await req.json());",
      `  if (!body.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });`,
      "  const user = await prisma.user.create({ data: body.data });",
    ),
    expect: ["api-route", "async-await", "input-validation", "orm-query"],
  },
  {
    name: "mixed: a stripe webhook that writes in a transaction",
    file: "app/api/webhooks/stripe/route.ts",
    code: L(
      "export async function POST(req: Request) {",
      `  const sig = req.headers.get("stripe-signature");`,
      "  try {",
      "    event = stripe.webhooks.constructEvent(await req.text(), sig, process.env.STRIPE_WEBHOOK_SECRET);",
      "  } catch (err) {",
      `    return new Response("Bad signature", { status: 400 });`,
      "  }",
      "  await prisma.$transaction(async (tx) => {",
    ),
    expect: ["api-route", "async-await", "webhook", "env-vars", "error-handling", "db-transaction"],
  },
  {
    name: "mixed: a client component that fetches and renders html",
    file: "components/CommentList.tsx",
    code: L(
      `"use client";`,
      "export function CommentList({ postId }: CommentListProps) {",
      "  const [comments, setComments] = useState<Comment[]>([]);",
      "  useEffect(() => {",
      "    fetch(`/api/comments?postId=${postId}`).then((r) => r.json()).then(setComments);",
      "  }, [postId]);",
      `  return <ul className="flex flex-col gap-2">{comments.map((c) => <li key={c.id} dangerouslySetInnerHTML={{ __html: c.html }} />)}</ul>;`,
    ),
    expect: ["client-server-boundary", "react-props", "react-state", "react-effect", "http-fetch", "css-layout", "xss-html-injection"],
  },
  {
    name: "mixed: a fastapi upload endpoint",
    file: "main.py",
    code: L(
      `@app.post("/avatars")`,
      `@limiter.limit("10/hour")`,
      "async def upload_avatar(request: Request, file: UploadFile, background_tasks: BackgroundTasks):",
      "    if file.size > MAX_BYTES:",
      `        raise HTTPException(status_code=413, detail="Too large")`,
      `    bucket = os.environ["AVATAR_BUCKET"]`,
      "    background_tasks.add_task(make_thumbnail, file.filename)",
    ),
    expect: ["api-route", "rate-limiting", "async-await", "file-upload", "background-job", "error-handling", "env-vars"],
  },
  {
    name: "mixed: an express login with an injectable query",
    file: "routes/login.js",
    code: L(
      `app.post("/login", loginLimiter, async (req, res) => {`,
      `  const user = await db.query("SELECT * FROM users WHERE email = '" + req.body.email + "'");`,
      "  const ok = await bcrypt.compare(req.body.password, user.password_hash);",
      `  if (!ok) return res.status(401).json({ error: "Invalid credentials" });`,
      "  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET);",
      `  res.cookie("session", token, { httpOnly: true });`,
    ),
    expect: ["api-route", "async-await", "sql-interpolation", "password-hashing", "auth-token", "env-vars"],
  },
];

const CORPUS: Case[] = [...POSITIVES, ...NEGATIVES, ...MIXED];

interface Tally {
  tp: number;
  fp: number;
  fn: number;
}

const ratio = (hit: number, total: number) => (total === 0 ? 1 : hit / total);
const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;

function evaluate(cases: readonly Case[]) {
  const per = new Map<string, Tally>(CONCEPTS.map((c) => [c.id, { tp: 0, fp: 0, fn: 0 }]));
  const misses: string[] = [];
  const falseClaims: string[] = [];
  const traps: string[] = [];
  for (const c of cases) {
    const hits = new Set(detectConcepts(c.file, c.code).map((h) => h.id));
    const expected = new Set(c.expect);
    for (const id of expected) {
      const t = per.get(id)!;
      if (hits.has(id)) t.tp++;
      else {
        t.fn++;
        misses.push(`${c.name}: missed ${id}`);
      }
    }
    for (const id of hits) {
      if (expected.has(id)) continue;
      const t = per.get(id);
      if (t) t.fp++;
      falseClaims.push(`${c.name}: claimed ${id}`);
    }
    for (const id of c.forbid ?? []) {
      if (hits.has(id)) traps.push(`${c.name}: fell for ${id}`);
    }
  }
  const total = [...per.values()].reduce(
    (sum, t) => ({ tp: sum.tp + t.tp, fp: sum.fp + t.fp, fn: sum.fn + t.fn }),
    { tp: 0, fp: 0, fn: 0 },
  );
  return {
    per,
    misses,
    falseClaims,
    traps,
    precision: ratio(total.tp, total.tp + total.fp),
    recall: ratio(total.tp, total.tp + total.fn),
  };
}

test("the corpus is big enough, labelled with real ids, and covers every concept", () => {
  assert.ok(CORPUS.length >= 60, `only ${CORPUS.length} cases`);
  assert.ok(NEGATIVES.length >= 20, `only ${NEGATIVES.length} negatives`);
  assert.ok(MIXED.length >= 5, `only ${MIXED.length} multi-concept cases`);
  assert.equal(new Set(CORPUS.map((c) => c.name)).size, CORPUS.length, "two cases share a name");

  const known = new Set(CONCEPTS.map((c) => c.id));
  const positives = new Map<string, number>();
  for (const c of CORPUS) {
    for (const id of [...c.expect, ...(c.forbid ?? [])]) assert.ok(known.has(id), `${c.name} names unknown concept ${id}`);
    for (const id of c.forbid ?? []) assert.ok(!c.expect.includes(id), `${c.name} both expects and forbids ${id}`);
    for (const id of c.expect) positives.set(id, (positives.get(id) ?? 0) + 1);
  }
  for (const c of NEGATIVES) assert.ok(c.forbid?.length, `${c.name} is a negative that forbids nothing`);
  for (const c of MIXED) assert.ok(c.expect.length >= 3, `${c.name} is not a multi-concept case`);
  // A concept with no positive case has a recall of nothing over nothing, which proves nothing.
  for (const id of known) assert.ok((positives.get(id) ?? 0) >= 2, `${id} has fewer than two positive cases`);
});

test("detection is precise and complete enough to be trusted over a realistic corpus", (t) => {
  const result = evaluate(CORPUS);

  const rows = [...result.per.entries()]
    .map(([id, tally]) => ({
      id,
      ...tally,
      precision: ratio(tally.tp, tally.tp + tally.fp),
      recall: ratio(tally.tp, tally.tp + tally.fn),
    }))
    .sort((a, b) => a.recall - b.recall || a.precision - b.precision || a.id.localeCompare(b.id));

  const width = Math.max(...rows.map((r) => r.id.length));
  t.diagnostic(`${"concept".padEnd(width)}  prec  recall  tp fp fn`);
  for (const r of rows) {
    t.diagnostic(
      `${r.id.padEnd(width)}  ${pct(r.precision)}  ${pct(r.recall)}   ${String(r.tp).padStart(2)} ${String(r.fp).padStart(2)} ${String(r.fn).padStart(2)}`,
    );
  }
  t.diagnostic(
    `overall: precision ${(result.precision * 100).toFixed(1)}%, recall ${(result.recall * 100).toFixed(1)}% over ${CORPUS.length} cases ` +
      `(${POSITIVES.length} positive, ${NEGATIVES.length} negative, ${MIXED.length} mixed); weakest: ${rows[0].id}`,
  );
  for (const line of [...result.traps, ...result.falseClaims, ...result.misses]) t.diagnostic(line);

  assert.deepEqual(result.traps, [], "a tempting negative produced the hit it exists to forbid");
  assert.ok(result.recall >= 0.9, `overall recall is ${(result.recall * 100).toFixed(1)}%`);
  assert.ok(result.precision >= 0.95, `overall precision is ${(result.precision * 100).toFixed(1)}%`);
  for (const r of rows) {
    assert.ok(r.recall >= 0.5, `${r.id} is detected in only ${pct(r.recall).trim()} of its cases`);
  }
});

test("the harness itself notices a miss and a false claim", () => {
  // Without this, a bug that made every tally zero would read as a perfect score.
  const broken = evaluate([
    { name: "probe: labelled with an idea that is not there", file: "a.ts", code: "const x = 1;", expect: ["react-state"] },
    { name: "probe: an idea that is there and not labelled", file: "a.tsx", code: "const [n, setN] = useState(0);", expect: [], forbid: ["react-state"] },
  ]);
  assert.equal(broken.recall, 0);
  assert.equal(broken.precision, 0);
  assert.equal(broken.misses.length, 1);
  assert.equal(broken.falseClaims.length, 1);
  assert.equal(broken.traps.length, 1);
});
