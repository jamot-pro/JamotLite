/**
 * The company dashboard as an MCP App (RUNTIME D45): one self-contained page
 * that a host such as Claude shows inside the conversation when the
 * `company_dashboard` tool runs. It loads nothing from anywhere: the host
 * hands it the tool's result, and its Refresh button calls the same tool
 * through the host, under the same connection, limits and access.
 *
 * It only reads. Proposals show their status; deciding stays with a person on
 * Telegram or in the console (D23).
 *
 * The page speaks the MCP Apps protocol by hand over postMessage
 * (`ui/initialize`, `ui/notifications/tool-result`, `tools/call`,
 * `ui/notifications/size-changed`); everything shown is set as text, never
 * as HTML.
 */

export const DASHBOARD_URI = "ui://jamot/company-dashboard";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
export const DASHBOARD_VIEWS = [
	"overview",
	"map",
	"activity",
	"proposals",
] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Company dashboard</title>
<style>
:root{
	--bg:var(--color-background-primary,#ffffff);
	--bg2:var(--color-background-secondary,#f5f5f4);
	--fg:var(--color-text-primary,#1c1917);
	--muted:var(--color-text-secondary,#78716c);
	--line:var(--color-border-primary,#e7e5e4);
	--accent:#1d4ed8;--good:#15803d;--warn:#b45309;--bad:#b91c1c;
	color-scheme:light dark;
}
:root[data-theme="dark"]{
	--bg:var(--color-background-primary,#1c1917);
	--bg2:var(--color-background-secondary,#292524);
	--fg:var(--color-text-primary,#f5f5f4);
	--muted:var(--color-text-secondary,#a8a29e);
	--line:var(--color-border-primary,#44403c);
	--accent:#93c5fd;--good:#86efac;--warn:#fcd34d;--bad:#fca5a5;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 var(--font-sans,system-ui,sans-serif)}
.wrap{padding:14px 16px}
header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap}
h1{font-size:17px;margin:0}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:16px 0 6px}
.muted{color:var(--muted)}
.tabs{display:flex;gap:4px;margin:12px 0 4px;border-bottom:1px solid var(--line);overflow-x:auto}
.tabs button{border:0;background:none;color:var(--muted);padding:6px 10px;font:inherit;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
button.refresh{border:1px solid var(--line);background:var(--bg2);color:var(--fg);border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer}
.bar{height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;margin:6px 0}
.bar>div{height:100%;background:var(--accent)}
ul{margin:0;padding:0;list-style:none}
li{padding:6px 0;border-bottom:1px solid var(--line)}
li:last-child{border-bottom:0}
.row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.pill{display:inline-block;font-size:12px;padding:0 7px;border-radius:9px;background:var(--bg2);color:var(--muted);white-space:nowrap}
.pill.good{color:var(--good)}.pill.warn{color:var(--warn)}.pill.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.stat{background:var(--bg2);border-radius:8px;padding:8px 10px}
.stat b{display:block;font-size:18px}
pre{white-space:pre-wrap;word-break:break-word;margin:4px 0 0;font-size:12px;color:var(--muted)}
.note{margin-top:12px;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap" id="app"><p class="muted">Loading the company…</p></div>
<script>
(function () {
	"use strict";
	var VIEWS = [["overview", "Overview"], ["map", "Map"], ["activity", "Activity"], ["proposals", "Proposals"]];
	var nextId = 1;
	var waiting = {};
	var data = null;
	var tab = "overview";
	var busy = false;
	var root = document.getElementById("app");

	function send(message) { window.parent.postMessage(message, "*"); }
	function request(method, params) {
		return new Promise(function (resolve, reject) {
			var id = nextId++;
			waiting[id] = { resolve: resolve, reject: reject };
			send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
		});
	}
	function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }

	window.addEventListener("message", function (event) {
		if (event.source !== window.parent) return;
		var m = event.data;
		if (!m || m.jsonrpc !== "2.0") return;
		if (m.id !== undefined && !m.method) {
			var w = waiting[m.id];
			if (!w) return;
			delete waiting[m.id];
			if (m.error) w.reject(m.error); else w.resolve(m.result);
			return;
		}
		if (m.method === "ui/notifications/tool-result") show(m.params);
		else if (m.method === "ui/notifications/host-context-changed") context(m.params);
		else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} });
	});

	function context(ctx) {
		if (!ctx) return;
		if (ctx.theme) document.documentElement.setAttribute("data-theme", ctx.theme);
		var vars = ctx.styles && ctx.styles.variables;
		if (vars) for (var k in vars) if (/^--[a-z0-9-]+$/i.test(k)) document.documentElement.style.setProperty(k, String(vars[k]));
	}

	function show(result) {
		var d = result && result.structuredContent;
		if (!d || !d.overview) {
			var said = result && result.content && result.content[0] && result.content[0].text;
			root.replaceChildren(el("p", { cls: "muted" }, (result && result.isError && said) || "Nothing to show."));
			resized();
			return;
		}
		data = d;
		if (d.view) tab = d.view;
		render();
	}

	function refresh() {
		if (busy) return;
		busy = true;
		render();
		request("tools/call", { name: "company_dashboard", arguments: { view: tab } })
			.then(function (r) { busy = false; show(r); }, function (err) {
				busy = false;
				render();
				root.appendChild(el("p", { cls: "pill bad" }, "Couldn't refresh: " + ((err && err.message) || "unknown error")));
				resized();
			});
	}

	function el(tag, opts, children) {
		var node = document.createElement(tag);
		opts = opts || {};
		if (opts.cls) node.className = opts.cls;
		if (opts.attrs) for (var a in opts.attrs) node.setAttribute(a, opts.attrs[a]);
		if (opts.onclick) node.addEventListener("click", opts.onclick);
		[].concat(children === undefined ? [] : children).forEach(function (c) {
			if (c === null || c === undefined || c === false) return;
			node.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
		});
		return node;
	}
	function list(items, empty) {
		return items.length ? el("ul", {}, items) : el("p", { cls: "muted" }, empty);
	}
	function when(iso) {
		if (!iso) return "";
		var t = new Date(iso);
		return isNaN(t.getTime()) ? String(iso) : t.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
	}
	function dollars(micro) { return "$" + ((Number(micro) || 0) / 1e6).toFixed(2); }

	function overview() {
		var o = data.overview, m = data.missing || { gaps: [], openIssues: [] };
		var c = o.charter || {};
		var pending = (data.proposals && data.proposals.pending) || [];
		var out = [];
		if (c.vision) out.push(el("p", {}, c.vision));
		out.push(el("h2", {}, "Readiness"));
		out.push(el("div", { cls: "row" }, [el("b", {}, (o.readiness || 0) + "%"), el("span", { cls: "pill " + (o.covered ? "good" : "warn") }, o.covered ? "fully covered" : "not covered yet")]));
		out.push(el("div", { cls: "bar" }, el("div", { attrs: { style: "width:" + Math.max(0, Math.min(100, Number(o.readiness) || 0)) + "%" } })));
		out.push(el("div", { cls: "grid" }, [
			el("div", { cls: "stat" }, [el("b", {}, String(Array.isArray(o.unowned) ? o.unowned.length : (o.unowned || 0))), "without an owner"]),
			el("div", { cls: "stat" }, [el("b", {}, String((m.openIssues || []).length)), "open issues"]),
			el("div", { cls: "stat" }, [el("b", {}, String(pending.length)), "waiting for approval"])
		]));
		out.push(el("h2", {}, "What's missing"));
		out.push(list((m.gaps || []).map(function (g) {
			return el("li", {}, [el("div", {}, g.area), el("div", { cls: "muted" }, (g.missing || []).join(", "))]);
		}), "Nothing — every part of the company is covered."));
		if ((m.openIssues || []).length) {
			out.push(el("h2", {}, "Open issues"));
			out.push(list(m.openIssues.map(function (t) { return el("li", {}, String(t)); }), ""));
		}
		if (c.mission || (c.values || []).length || (c.goals || []).length) {
			out.push(el("h2", {}, "Charter"));
			if (c.mission) out.push(el("p", {}, [el("b", {}, "Mission: "), c.mission]));
			if ((c.values || []).length) out.push(el("p", {}, [el("b", {}, "Values: "), c.values.join(" · ")]));
			if ((c.goals || []).length) out.push(el("p", {}, el("b", {}, "Goals:")), list(c.goals.map(function (g) { return el("li", {}, String(g)); }), ""));
		}
		return out;
	}

	function map() {
		var mp = data.map || {};
		var groups = [["team", "Teams"], ["human", "People"], ["agent", "Agents"], ["responsibility", "Responsibilities"], ["heartbeat", "Heartbeats"], ["tool", "Tools"]];
		var out = [];
		groups.forEach(function (g) {
			var items = mp[g[0]] || [];
			if (!items.length) return;
			out.push(el("h2", {}, g[1] + " (" + items.length + ")"));
			out.push(list(items.map(function (n) {
				var right = null;
				if (g[0] === "responsibility") {
					var owners = (n.owners || []).filter(Boolean);
					right = el("span", { cls: "pill " + (owners.length ? "good" : "warn") }, owners.length ? owners.join(", ") : "no owner");
				} else if (g[0] === "heartbeat" && n.schedule) right = el("span", { cls: "pill" }, String(n.schedule));
				return el("li", { cls: "row" }, [el("span", {}, n.name), right]);
			}), ""));
		});
		return out.length ? out : [el("p", { cls: "muted" }, "The company map is empty.")];
	}

	function activity() {
		var a = data.activity || { runs: [], last30Days: {} };
		var t = a.last30Days || {};
		var out = [el("h2", {}, "Last 30 days")];
		out.push(el("div", { cls: "grid" }, [
			el("div", { cls: "stat" }, [el("b", {}, String(t.runs || 0)), "runs"]),
			el("div", { cls: "stat" }, [el("b", {}, dollars(t.costMicroUsd)), "spent on models"])
		]));
		out.push(el("h2", {}, "Recent runs"));
		out.push(list((a.runs || []).map(function (r) {
			var cls = r.status === "done" ? "good" : r.status === "error" ? "bad" : "";
			return el("li", {}, [
				el("div", { cls: "row" }, [el("span", {}, (r.agent || "?") + " · " + (r.trigger || "")), el("span", { cls: "pill " + cls }, String(r.status))]),
				el("div", { cls: "muted" }, when(r.at) + (r.costMicroUsd ? " · " + dollars(r.costMicroUsd) : "")),
				r.error ? el("pre", {}, String(r.error)) : null,
				r.output ? el("pre", {}, String(r.output).slice(0, 300)) : null
			]);
		}), "No runs yet."));
		return out;
	}

	function proposals() {
		var p = data.proposals || { pending: [], decided: [] };
		var out = [el("h2", {}, "Waiting for a person")];
		out.push(list((p.pending || []).map(function (a) {
			return el("li", {}, [
				el("div", { cls: "row" }, [el("span", {}, a.agent + " wants to " + a.tool), el("span", { cls: "pill warn" }, "waiting")]),
				el("div", { cls: "muted" }, "since " + when(a.since)),
				el("pre", {}, JSON.stringify(a.args, null, 1).slice(0, 400))
			]);
		}), "Nothing is waiting."));
		if ((p.decided || []).length) {
			out.push(el("h2", {}, "Decided"));
			out.push(list(p.decided.map(function (a) {
				return el("li", { cls: "row" }, [
					el("span", {}, a.agent + " · " + a.tool),
					el("span", { cls: "pill " + (a.status === "approved" ? "good" : "bad") }, a.status + (a.by ? " by " + a.by : ""))
				]);
			}), ""));
		}
		out.push(el("p", { cls: "note" }, "Proposals are decided by a person on Telegram or in the console — never from here."));
		return out;
	}

	function render() {
		if (!data) return;
		var o = data.overview;
		var name = (o.company && o.company.name) || "The company";
		var who = data.caller && data.caller.as ? "Connected as " + data.caller.as : "Connected with the owner's token";
		var body = { overview: overview, map: map, activity: activity, proposals: proposals }[tab] || overview;
		root.replaceChildren(
			el("header", {}, [
				el("div", {}, [el("h1", {}, name), el("div", { cls: "muted" }, who)]),
				el("button", { cls: "refresh", onclick: refresh, attrs: busy ? { disabled: "" } : {} }, busy ? "Refreshing…" : "Refresh")
			]),
			el("div", { cls: "tabs", attrs: { role: "tablist" } }, VIEWS.map(function (v) {
				return el("button", { attrs: { role: "tab", "aria-selected": String(tab === v[0]) }, onclick: function () { tab = v[0]; render(); } }, v[1]);
			})),
			el("div", {}, body())
		);
		resized();
	}

	var lastHeight = 0;
	function resized() {
		var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
		if (h === lastHeight) return;
		lastHeight = h;
		notify("ui/notifications/size-changed", { height: h });
	}
	if (window.ResizeObserver) new ResizeObserver(resized).observe(document.body);

	request("ui/initialize", {
		protocolVersion: "2025-06-18",
		clientInfo: { name: "jamot-company-dashboard", version: "1" },
		appInfo: { name: "jamot-company-dashboard", version: "1" },
		capabilities: {},
		appCapabilities: {}
	}).then(function (r) {
		context(r && r.hostContext);
		notify("ui/notifications/initialized");
	}, function () {
		notify("ui/notifications/initialized");
	});
})();
</script>
</body>
</html>
`;
