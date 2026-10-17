import { Component, signal, inject, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
})
export class DashboardComponent {
  http = inject(HttpClient);

  isProcessing = signal<boolean>(false);
  agentResponse = signal<any>(null);
  activeScenario = signal<string>('');
  hitlEnabled = signal<boolean>(false); // <--- NEW: Tracks the HITL toggle state

  chart: any;

  constructor() {
    afterNextRender(() => {
      this.initChart();
      this.fetchChartData('STEADY_STATE'); // Dynamically load initial data
    });
  }

  initChart() {
    const ctx = document.getElementById('telemetryChart') as HTMLCanvasElement;
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['10:00', '11:00', '12:00'],
        datasets: [{
          label: 'Compute Usage (ms)',
          data: [], // Starts empty, filled by API
          borderColor: '#00ff9f',
          backgroundColor: 'rgba(0, 255, 159, 0.1)',
          borderDash: [5, 5],
          pointBackgroundColor: '#00ff9f',
          tension: 0.1,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: '#24283b' } },
          x: { grid: { color: '#24283b' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  fetchChartData(scenarioId: string) {
    this.http.get<{metrics: any[]}>(`http://localhost:3000/api/telemetry/${scenarioId}`)
      .subscribe({
        next: (res) => {
          // 1. Dynamically update X-axis labels using the timestamps
          this.chart.data.labels = res.metrics.map(m => {
            const d = new Date(m.timestamp);
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
          });

          // 2. Map the API calls metric to the Y-axis data points
          this.chart.data.datasets[0].data = res.metrics.map(m => m.api_calls_per_sec);

          // 3. Apply thematic colors
          if (scenarioId === 'VIRAL_SPIKE') {
            this.chart.data.datasets[0].borderColor = '#ffb86c';
            this.chart.data.datasets[0].pointBackgroundColor = '#ffb86c';
          } else if (scenarioId === 'USAGE_DROP') {
            this.chart.data.datasets[0].borderColor = '#ff5555';
            this.chart.data.datasets[0].pointBackgroundColor = '#ff5555';
          } else {
            this.chart.data.datasets[0].borderColor = '#00ff9f';
            this.chart.data.datasets[0].pointBackgroundColor = '#00ff9f';
          }
          this.chart.update();
        },
        error: (err) => console.error("Telemetry Fetch Error:", err)
      });
  }

  // <--- NEW: Method to handle the toggle switch state --->
  toggleHitl() {
    this.hitlEnabled.update(val => !val);
  }

  runScenario(scenarioId: string, scenarioName: string) {
    this.activeScenario.set(scenarioName);
    this.isProcessing.set(true);
    this.agentResponse.set(null);

    // 1. Fetch JSON data instantly for the UI chart update
    this.fetchChartData(scenarioId);

    // 2. Trigger the backend AI Agent execution
    this.http.post('http://localhost:3000/api/run-agent', {
      scenarioId,
      requireApproval: this.hitlEnabled()
    })
      .subscribe({
        next: (response: any) => {
          this.agentResponse.set(response);
          this.isProcessing.set(false);

          // 3. Check if the backend paused for HITL approval
          const requiresManualApproval = response.logs.some((log: string) => log.includes("awaiting manual approval"));

          if (requiresManualApproval) {
            // Wait 100ms for the DOM to update the terminal logs before firing the alert
            setTimeout(() => {
              const userConfirmed = window.confirm(
                `[HITL ALERT] The AI Agent recommends a billing migration based on the telemetry analysis.\n\nDo you approve the execution of this Stripe subscription update?`
              );

              if (userConfirmed) {
                // If approved, immediately run the scenario again with the guard disabled
                this.isProcessing.set(true);

                this.http.post('http://localhost:3000/api/run-agent', {
                  scenarioId,
                  requireApproval: false // Force the migration through
                }).subscribe({
                  next: (finalResponse) => {
                    this.agentResponse.set(finalResponse);
                    this.isProcessing.set(false);
                  },
                  error: (err) => {
                    console.error("Final Agent Error:", err);
                    this.isProcessing.set(false);
                  }
                });
              }
            }, 100);
          }
        },
        error: (err) => {
          console.error("Agent Error:", err);
          this.isProcessing.set(false);
        }
      });
  }
}
