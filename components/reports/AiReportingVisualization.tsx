import { BarChart3, ChevronDown, ChevronUp, Table2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from '@/components/ui/chart';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  AiReportingVisualization as AiReportingVisualizationDefinition,
  AiReportingVisualizationSeries,
} from './aiReportingVisualizations';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'color-mix(in oklch, var(--chart-1) 65%, var(--background))',
  'color-mix(in oklch, var(--chart-2) 65%, var(--background))',
  'color-mix(in oklch, var(--chart-3) 65%, var(--background))',
  'color-mix(in oklch, var(--chart-4) 65%, var(--background))',
  'color-mix(in oklch, var(--chart-5) 65%, var(--background))',
] as const;

const DEFAULT_TYPE_LABELS = {
  area: 'Area chart',
  bar: 'Bar chart',
  donut: 'Donut chart',
  line: 'Line chart',
  pie: 'Pie chart',
} as const;

interface AiReportingVisualizationProps {
  visualization: AiReportingVisualizationDefinition;
  language: string;
}

const getFractionDigits = (series: AiReportingVisualizationSeries) =>
  series.decimals ?? (series.format === 'currency' ? 2 : series.format === 'percent' ? 1 : 2);

const formatVisualizationValue = (
  value: number,
  series: AiReportingVisualizationSeries,
  language: string,
) => {
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: series.decimals,
    maximumFractionDigits: getFractionDigits(series),
  };

  if (series.format === 'currency' && series.currency) {
    options.style = 'currency';
    options.currency = series.currency;
  }

  const formatted = new Intl.NumberFormat(language, options).format(value);
  const formattedValue = series.format === 'percent' ? `${formatted}%` : formatted;
  return series.unit ? `${formattedValue} ${series.unit}` : formattedValue;
};

const buildChartConfig = (visualization: AiReportingVisualizationDefinition): ChartConfig =>
  Object.fromEntries(
    visualization.series.map((series, index) => [
      series.key,
      {
        label: series.label,
        color: CHART_COLORS[index],
      },
    ]),
  );

interface VisualizationTooltipProps {
  visualization: AiReportingVisualizationDefinition;
  language: string;
}

const VisualizationTooltip = ({ visualization, language }: VisualizationTooltipProps) => (
  <ChartTooltip
    cursor={false}
    content={
      <ChartTooltipContent
        formatter={(value, name, item) => {
          const seriesKey = String(item.dataKey ?? name);
          const series = visualization.series.find((candidate) => candidate.key === seriesKey);
          if (!series || typeof value !== 'number') return null;

          return (
            <div className="flex min-w-40 items-center justify-between gap-4">
              <span className="text-muted-foreground">{series.label}</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatVisualizationValue(value, series, language)}
              </span>
            </div>
          );
        }}
      />
    }
  />
);

const CartesianVisualization = ({ visualization, language }: VisualizationTooltipProps) => {
  const isHorizontalBar =
    visualization.type === 'bar' && visualization.orientation === 'horizontal';
  const firstSeries = visualization.series[0];
  const axisFormatter = (value: number) =>
    new Intl.NumberFormat(language, {
      notation: 'compact',
      maximumFractionDigits: Math.min(getFractionDigits(firstSeries), 2),
    }).format(value);
  const commonChildren = (
    <>
      <CartesianGrid vertical={isHorizontalBar} horizontal={!isHorizontalBar} />
      {isHorizontalBar ? (
        <>
          <XAxis type="number" tickFormatter={axisFormatter} tickLine={false} axisLine={false} />
          <YAxis
            dataKey={visualization.xKey}
            type="category"
            width={96}
            tickLine={false}
            axisLine={false}
          />
        </>
      ) : (
        <>
          <XAxis
            dataKey={visualization.xKey}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={24}
          />
          <YAxis tickFormatter={axisFormatter} tickLine={false} axisLine={false} width={56} />
        </>
      )}
      <VisualizationTooltip visualization={visualization} language={language} />
      {visualization.series.length > 1 ? (
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-2" />} />
      ) : null}
    </>
  );

  if (visualization.type === 'bar') {
    return (
      <BarChart
        accessibilityLayer
        data={visualization.data}
        layout={isHorizontalBar ? 'vertical' : 'horizontal'}
        margin={{ left: 4, right: 12, top: 8 }}
      >
        {commonChildren}
        {visualization.series.map((series) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            fill={`var(--color-${series.key})`}
            radius={visualization.stacked ? 0 : 5}
            stackId={visualization.stacked ? 'total' : undefined}
          />
        ))}
      </BarChart>
    );
  }

  if (visualization.type === 'area') {
    return (
      <AreaChart
        accessibilityLayer
        data={visualization.data}
        margin={{ left: 4, right: 12, top: 8 }}
      >
        {commonChildren}
        {visualization.series.map((series) => (
          <Area
            key={series.key}
            dataKey={series.key}
            type="monotone"
            fill={`var(--color-${series.key})`}
            fillOpacity={0.18}
            stroke={`var(--color-${series.key})`}
            strokeWidth={2}
            stackId={visualization.stacked ? 'total' : undefined}
          />
        ))}
      </AreaChart>
    );
  }

  return (
    <LineChart accessibilityLayer data={visualization.data} margin={{ left: 4, right: 12, top: 8 }}>
      {commonChildren}
      {visualization.series.map((series) => (
        <Line
          key={series.key}
          dataKey={series.key}
          type="monotone"
          stroke={`var(--color-${series.key})`}
          strokeWidth={2}
          dot={visualization.data.length <= 12}
          activeDot={{ r: 5 }}
        />
      ))}
    </LineChart>
  );
};

interface CircularVisualizationProps extends VisualizationTooltipProps {
  config: ChartConfig;
}

const CircularVisualization = ({ visualization, language, config }: CircularVisualizationProps) => {
  const series = visualization.series[0];
  const pieData: Array<Record<string, number | string>> = visualization.data.map(
    (datum, index) => ({
      ...datum,
      fill: CHART_COLORS[index % CHART_COLORS.length],
    }),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-center">
      <ChartContainer
        config={config}
        className="mx-auto h-72 w-full max-w-xl aspect-auto"
        aria-label={visualization.title}
      >
        <PieChart accessibilityLayer>
          <VisualizationTooltip visualization={visualization} language={language} />
          <Pie
            data={pieData}
            dataKey={series.key}
            nameKey={visualization.xKey}
            innerRadius={visualization.type === 'donut' ? 70 : 0}
            outerRadius={112}
            paddingAngle={visualization.type === 'donut' ? 2 : 1}
            strokeWidth={2}
          />
        </PieChart>
      </ChartContainer>
      <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
        {pieData.map((datum, index) => (
          <div
            key={`${String(datum[visualization.xKey])}-${index}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: String(datum.fill) }}
                aria-hidden="true"
              />
              <span className="truncate">{String(datum[visualization.xKey])}</span>
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {formatVisualizationValue(Number(datum[series.key]), series, language)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface VisualizationDataTableProps extends AiReportingVisualizationProps {
  label: string;
}

const VisualizationDataTable = ({
  visualization,
  language,
  label,
}: VisualizationDataTableProps) => (
  <div className="max-h-72 overflow-auto border-t">
    <Table aria-label={label}>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead>{visualization.xLabel || visualization.xKey}</TableHead>
          {visualization.series.map((series) => (
            <TableHead key={series.key} className="text-right">
              {series.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visualization.data.map((datum, index) => (
          <TableRow key={`${String(datum[visualization.xKey])}-${index}`}>
            <TableCell className="font-medium">{String(datum[visualization.xKey])}</TableCell>
            {visualization.series.map((series) => (
              <TableCell key={series.key} className="text-right font-mono tabular-nums">
                {formatVisualizationValue(Number(datum[series.key]), series, language)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

export const AiReportingVisualization = ({
  visualization,
  language,
}: AiReportingVisualizationProps) => {
  const { t } = useTranslation('reports');
  const titleId = useId();
  const [isTableOpen, setIsTableOpen] = useState(false);
  const config = useMemo(() => buildChartConfig(visualization), [visualization]);
  const isCircular = visualization.type === 'pie' || visualization.type === 'donut';
  const typeLabel = t(`aiReporting.visualizationTypes.${visualization.type}`, {
    defaultValue: DEFAULT_TYPE_LABELS[visualization.type],
  });

  return (
    <Card
      role="figure"
      aria-labelledby={titleId}
      className="my-4 gap-0 overflow-hidden rounded-2xl py-0"
    >
      <CardHeader className="border-b px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle id={titleId} className="text-base leading-snug">
              {visualization.title}
            </CardTitle>
            {visualization.description ? (
              <CardDescription>{visualization.description}</CardDescription>
            ) : null}
          </div>
          <Badge variant="secondary" className="shrink-0 gap-1.5">
            <BarChart3 aria-hidden="true" />
            {typeLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-3 py-4 sm:px-5">
        {isCircular ? (
          <CircularVisualization
            visualization={visualization}
            language={language}
            config={config}
          />
        ) : (
          <ChartContainer
            config={config}
            className="h-80 w-full aspect-auto"
            aria-label={visualization.title}
          >
            <CartesianVisualization visualization={visualization} language={language} />
          </ChartContainer>
        )}
      </CardContent>
      <Collapsible open={isTableOpen} onOpenChange={setIsTableOpen}>
        <CardFooter className="justify-end border-t px-3 py-2 sm:px-4">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="gap-2">
              <Table2 aria-hidden="true" />
              {isTableOpen
                ? t('aiReporting.hideVisualizationData', { defaultValue: 'Hide data' })
                : t('aiReporting.showVisualizationData', { defaultValue: 'Show data' })}
              {isTableOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            </Button>
          </CollapsibleTrigger>
        </CardFooter>
        <CollapsibleContent>
          <VisualizationDataTable
            visualization={visualization}
            language={language}
            label={t('aiReporting.visualizationDataTable', {
              defaultValue: 'Data used for {{title}}',
              title: visualization.title,
            })}
          />
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export const AiReportingVisualizationPending = () => {
  const { t } = useTranslation('reports');

  return (
    <Card
      className="my-4 gap-4 rounded-2xl p-5"
      role="status"
      aria-label={t('aiReporting.visualizationRendering', {
        defaultValue: 'Building visualization...',
      })}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </Card>
  );
};
