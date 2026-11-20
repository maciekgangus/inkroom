package main

// buildVersion is the release the binary was built from, set with -ldflags "-X main.buildVersion=…"
// by the image build (R-099); "" for a plain `go build`.
var buildVersion = ""

// serverVersion is the version the server reports to browsers: APP_VERSION when set (tests and
// local trials), else the one built in, else "dev" (R-099).
func serverVersion(env, built string) string {
	if env != "" {
		return env
	}
	if built != "" {
		return built
	}
	return "dev"
}

// configureVersion sets the version given to the client in /api/config (R-099).
func (a *app) configureVersion(v string) { a.version = v }
