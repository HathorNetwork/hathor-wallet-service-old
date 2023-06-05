/*
This flake.nix file creates a virtual environment with the desired dependencies 
in a reproducible way using Nix and Nix flakes (https://nixos.wiki/wiki/Flakes)

Flakes are a feature in Nix that allows you to specify the dependencies of your
project in a declarative and reproducible manner. It allows for better isolation,
reproducibility, and more reliable upgrades.

`direnv` is an environment switcher for the shell. It knows how to hook into 
multiple shells (like bash, zsh, fish, etc...) to load or unload environment
variables depending on the current directory. This allows project-specific
environment variables without cluttering the "~/.profile" file.

This flake file creates a shell with nodejs v14.x installed and should work
on macOs, linux and windows
*/
{
  description = "Flake that installs Node.js 14.x via direnv";

  inputs.devshell.url = "github:numtide/devshell";
  inputs.flake-utils.url = "github:numtide/flake-utils";

  outputs = { self, flake-utils, devshell, nixpkgs }:

    flake-utils.lib.eachDefaultSystem (system: {
      devShell =
        let pkgs = import nixpkgs {
          inherit system;

          overlays = [ devshell.overlay ];
        };
        in
        pkgs.devshell.mkShell {
          packages = with pkgs; [
            nodejs-14_x
          ];
        };
    });
}
