# Luxury Hotel Smart Room Control Specification

## Version 1.0

Create the world's best luxury hotel smart-room control interface.

This is **not** a generic smart-home dashboard.

### Design references

-   Savant TrueImage
-   Control4 OS
-   Apple Home
-   Mercedes Hyperscreen
-   Lucid Air UI
-   Bang & Olufsen
-   Aston Martin HMI

## Platform

Desktop (16:10), scalable, target resolution 2560×1600.

## Visual language

-   Background: #0B1220
-   Glass cards: rgba(255,255,255,0.06)
-   Blur: 40px
-   Hairline borders
-   Gold accent: #E3B23C
-   Blue accent: #5B93F0
-   Elegant geometric sans-serif typography (Inter / SF Pro / Manrope)
-   Minimal, cinematic, premium.

## Layout

Header → Scenes → Status Pills → Digital Twin (65% height) → Controls →
Bottom Navigation

## Digital Twin

Photorealistic luxury suite with bedroom, living room, bathroom,
wardrobe, entrance, windows, balcony and animated lighting, curtains and
HVAC. Warm pools of light, realistic reflections and subtle glow.

## Interactive systems

Lighting: - Individual fixtures - Brightness - Color temperature -
Animated transitions

Climate: - Cooling / Heating / Dry / Auto / Fan / Sleep - Animated
airflow ribbons - Target/current temperature - Humidity - AQI / PM2.5 /
CO₂

Curtains: - 0 / 25 / 50 / 75 / 100% - Natural opening animation -
Dynamic sunlight

Scenes: Movie, Night, Morning, Reading, Cleaning, Relax, Away.

## UI Components

-   Glass scene cards
-   Status pills
-   Circular thermostat
-   Zone lighting controls
-   Curtain controls
-   Airflow visualization
-   Bottom navigation

## Motion

-   Spring animations
-   Lighting: 500ms
-   Curtains: 1200ms
-   Hover: 150ms
-   Continuous airflow

## Tech Stack

-   React 19
-   TypeScript
-   Next.js
-   Tailwind CSS
-   Framer Motion
-   React Three Fiber
-   Zustand
-   TanStack Query
-   Radix UI
-   Lucide Icons

## Goal

The interface should feel like an Apple keynote-quality product demo and
represent a real-time luxury hotel suite digital twin.
