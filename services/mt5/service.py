"""Read-only bridge to a dedicated portable MT5 terminal. Spawned by Node, one request at a time.

Environment: MT5_SERVICE_TOKEN, MT5_TERMINAL_PATH. Prints its port on stdout, exits when stdin closes.

It never attaches to another terminal: the path is always explicit, it must hold the portable.txt that
setup writes, and the terminal reached is checked before any login, because a login switches the
account of whichever terminal is attached. It contains no trading calls. Passwords are never logged
or returned.
"""
import hmac
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import MetaTrader5 as mt5

TOKEN = os.environ["MT5_SERVICE_TOKEN"]
TERMINAL = os.environ["MT5_TERMINAL_PATH"]
TERMINAL_DIR = os.path.dirname(TERMINAL)
MAX_BODY = 16 * 1024
INIT_TIMEOUT_MS = 120_000  # A first start also compiles the bundled MQL5 files, seen taking 3 minutes.
LOGIN_TIMEOUT_MS = 60_000
HISTORY_SETTLE_SECONDS = 25
# Deal times can run ahead of UTC by the broker's offset, so "now" alone could miss the newest deals.
TO_MARGIN_SECONDS = 2 * 86400
SYMBOL_FIELDS = ("name", "trade_contract_size", "digits", "point", "trade_tick_size", "trade_tick_value", "currency_base", "currency_profit")

# Seen on 5.0.6180 build 6254 with fake logins:
#   login on a real server, wrong login and password -> -6 "Terminal: Authorization failed"
#   login on a server name that does not exist       -> -10005 "IPC timeout" once the timeout runs out
#   initialize while the terminal is busy or hung    -> -10005 "IPC timeout", -10002 "IPC recv failed"
AUTH_FAILED = -6
IPC_ERRORS = (-10001, -10002, -10003, -10004, -10005)

_terminal = None
_last_login = None


class SessionError(Exception):
    def __init__(self, category, message, code=None):
        super().__init__(message)
        self.category = category
        self.message = message
        self.code = code


def is_dedicated(path):
    return os.path.normcase(os.path.realpath(path)) == os.path.normcase(os.path.realpath(TERMINAL_DIR))


def forget_saved_logins():
    """The terminal saves logins here and signs in with them at its next start. Only ever this folder."""
    try:
        os.remove(os.path.join(TERMINAL_DIR, "Config", "accounts.dat"))
    except FileNotFoundError:
        pass


def start_terminal():
    """Our own child, so killing this process tree ends it too, and nothing else."""
    global _terminal, _last_login
    if _terminal is not None and _terminal.poll() is None:
        return
    _last_login = None
    forget_saved_logins()
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 7  # SW_SHOWMINNOACTIVE: stays out of the user's way
    _terminal = subprocess.Popen([TERMINAL, "/portable"], cwd=TERMINAL_DIR, startupinfo=info, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop_terminal():
    if _terminal is not None and _terminal.poll() is None:
        _terminal.kill()
        _terminal.wait(10)
    forget_saved_logins()


def login_category(code):
    if code == AUTH_FAILED:
        return "wrong_password"
    # Also what an unreachable broker would give. The API has no separate code for it.
    return "invalid_server" if code in IPC_ERRORS else "other"


def fail(category, what):
    code, message = mt5.last_error()
    raise SessionError(category, f"{what}: {message}", code)


def rows(items):
    return [r._asdict() for r in items] if items else []


def history(fetch, what):
    """None can mean an error or just no history, so only a real error code fails the sync."""
    out = fetch()
    if out is None and mt5.last_error()[0] != 1:
        fail("other", what)
    return rows(out)


def wait_for_history(start, end):
    """A fresh login keeps downloading history, and an early read would look like a short account."""
    last, deadline = -1, time.monotonic() + HISTORY_SETTLE_SECONDS
    while time.monotonic() < deadline:
        total = mt5.history_deals_total(start, end)
        if total is not None and total == last:
            return
        last = total
        time.sleep(2)


def read_account(login, start, terminal):
    account = mt5.account_info()
    if account is None:
        fail("no_connection", "No account data after login")
    if account.login != login:
        raise SessionError("other", "The terminal is on a different account than requested.")

    end = int(time.time()) + TO_MARGIN_SECONDS
    wait_for_history(start, end)
    deals = history(lambda: mt5.history_deals_get(start, end), "Could not read deals")
    orders = history(lambda: mt5.history_orders_get(start, end), "Could not read order history")
    positions = rows(mt5.positions_get())
    open_orders = rows(mt5.orders_get())

    symbols = {}
    for name in sorted({r["symbol"] for r in deals + orders + positions + open_orders if r.get("symbol")}):
        mt5.symbol_select(name, True)
        spec = mt5.symbol_info(name)
        if spec is not None:
            symbols[name] = {k: getattr(spec, k) for k in SYMBOL_FIELDS}

    # The newest quote anywhere stands in for TimeCurrent. Node decides if it is fresh enough to trust.
    quotes = mt5.symbols_get() or []
    return {
        "ok": True,
        "account": account._asdict(),
        "positions": positions,
        "orders": open_orders,
        "deals": deals,
        "history_orders": orders,
        "symbols": symbols,
        "quote_time": max((s.time for s in quotes), default=None),
        "utc_now": time.time(),
        "terminal_connected": bool(terminal.connected),
        "terminal_build": terminal.build,
    }


def run_session(login, server, password, start):
    global _last_login
    if not os.path.isfile(TERMINAL) or not os.path.isfile(os.path.join(TERMINAL_DIR, "portable.txt")):
        raise SessionError("terminal_missing", "The dedicated MT5 terminal is missing. Run: node scripts/setup-mt5.mjs")
    start_terminal()
    try:
        # The login goes in here, not afterwards: a terminal with no account sits at its first-run
        # screen, and without credentials initialize times out waiting for it.
        if not mt5.initialize(path=TERMINAL, portable=True, login=login, password=password, server=server, timeout=INIT_TIMEOUT_MS):
            code, message = mt5.last_error()
            raise SessionError(login_category(code), f"Could not sign in: {message}", code)

        terminal = mt5.terminal_info()
        if terminal is None or not is_dedicated(terminal.path):
            raise SessionError("terminal_missing", "Reached a different terminal than the dedicated one, so no login was attempted.")

        # A server list copied from another terminal once signed this one in to that terminal's account.
        # Setup no longer copies it, but fail closed and read nothing if anything like that happens again.
        current = mt5.account_info()
        if current is not None and current.login not in (login, _last_login):
            stop_terminal()
            raise SessionError("other", "The dedicated terminal signed in to another account by itself, so nothing was read.")

        _last_login = login
        return read_account(login, start, terminal)
    except SessionError as e:
        if e.code in IPC_ERRORS:
            stop_terminal()  # Once a call times out, the terminal stays unresponsive to the next one.
        raise
    finally:
        mt5.shutdown()


def parse_request(raw):
    data = json.loads(raw)
    login, server, password, start = data.get("login"), data.get("server"), data.get("password"), data.get("from")
    valid = (
        type(login) is int and login > 0
        and isinstance(server, str) and 0 < len(server) <= 128
        and isinstance(password, str) and 0 < len(password) <= 256
        and type(start) in (int, float) and start >= 0
    )
    return (login, server, password, int(start)) if valid else None


class Handler(BaseHTTPRequestHandler):
    timeout = 30  # A stalled client must not block the single request slot.

    def log_message(self, format, *args):
        pass  # Nothing is logged.

    def reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if hmac.compare_digest(self.headers.get("x-mt5-token", "").encode(), TOKEN.encode()):
            return True
        self.reply(401, {"ok": False, "category": "other", "message": "Unauthorized"})
        return False

    def do_GET(self):
        if not self.authorized():
            return
        if self.path != "/health":
            return self.reply(404, {"ok": False})
        self.reply(200, {"ok": True, "terminal_exists": os.path.isfile(TERMINAL), "package": mt5.__version__})

    def do_POST(self):
        if not self.authorized():
            return
        if self.path != "/session":
            return self.reply(404, {"ok": False})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.reply(413, {"ok": False, "category": "other", "message": "Bad request size"})
        try:
            parsed = parse_request(self.rfile.read(length))
        except ValueError:
            parsed = None
        if parsed is None:
            return self.reply(422, {"ok": False, "category": "other", "message": "Invalid request"})
        password = parsed[2]
        try:
            self.reply(200, run_session(*parsed))
        except SessionError as e:
            self.reply(200, {"ok": False, "category": e.category, "message": e.message.replace(password, "***"), "code": e.code})
        except Exception as e:  # The message could echo arguments, so only the type goes back.
            self.reply(200, {"ok": False, "category": "other", "message": f"Unexpected {type(e).__name__}"})


def exit_with_parent():
    sys.stdin.read()
    stop_terminal()
    os._exit(0)


def main():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=exit_with_parent, daemon=True).start()
    print(server.server_address[1], flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
