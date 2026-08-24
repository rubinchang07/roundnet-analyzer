# Roundnet Analyzer

A web application for analyzing roundnet match footage and tracking gameplay statistics.

The goal of Roundnet Analyzer is to make reviewing match footage easier by allowing players to mark important events in a video and return to them instantly.

## Current Features

- Upload roundnet match footage
- Play and review footage directly in the browser
- Mark serves while watching a match
- Automatically record the timestamp of each marked serve
- Click a recorded serve to jump directly back to that moment in the video

## Planned Features

Future versions of the project may include:

- Tagging serve outcomes (ace, fault, return, etc.)
- Tracking individual players
- Recording point outcomes
- Serve percentage and efficiency statistics
- Offensive and defensive statistics
- Match summaries and stat dashboards
- Saving match analysis between sessions
- Improved video navigation and event tagging

## Why I Built This

Roundnet players often review match footage to evaluate serving, offense, defense, and decision-making. However, manually searching through an entire match can make detailed analysis tedious.

Roundnet Analyzer is designed to turn match footage into structured, searchable gameplay data.

## Tech Stack

- React
- JavaScript
- Vite
- HTML/CSS

## Getting Started

Clone the repository:

```bash
git clone https://github.com/rubinchang07/roundnet-analyzer.git
cd roundnet-analyzer
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the local address provided by Vite in your browser.

## Project Status

Currently in development.

The first prototype supports video uploads, serve timestamping, and navigation between marked serves.