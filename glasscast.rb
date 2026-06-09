cask "glasscast" do
  arch arm: "arm64", intel: "x64"

  version "2.0.0"
  sha256 arm:   "e669ab7c8bdd4596211937183ee2374545da5482702cab0dfe477c1466422b0f",
         intel: "85f5183219de0b656400625797ff9299893bd8fbda8455b0f745878b2c729526"

  url "https://github.com/henrybrewer00-dotcom/Glasscast/releases/download/v#{version}/Glasscast-#{arch}.dmg"
  name "Glasscast"
  desc "Cinematic screen recordings, zero editing"
  homepage "https://github.com/henrybrewer00-dotcom/Glasscast"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Glasscast.app"

  zap trash: [
    "~/Library/Application Support/Glasscast",
    "~/Library/Preferences/dev.glasscast.app.plist",
    "~/Library/Saved Application State/dev.glasscast.app.savedState",
  ]
end
