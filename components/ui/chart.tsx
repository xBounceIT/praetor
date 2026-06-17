import * as React from 'react';
import type {
  DefaultLegendContentProps,
  DefaultTooltipContentProps,
  TooltipValueType,
} from 'recharts';

import { cn } from '@/lib/utils';

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: '', dark: '.dark' } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
type RechartsModule = typeof import('recharts');
type RechartsComponentProps<K extends keyof RechartsModule> =
  RechartsModule[K] extends React.ComponentType<infer Props> ? Props : never;
type TooltipNameType = number | string;
type ChartTooltipContentProps = RechartsComponentProps<'Tooltip'> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: 'line' | 'dot' | 'dashed';
    nameKey?: string;
    labelKey?: string;
  } & Omit<DefaultTooltipContentProps<TooltipValueType, TooltipNameType>, 'accessibilityLayer'>;

const lazyRechartsComponent = <K extends keyof RechartsModule>(componentName: K) =>
  React.lazy(async () => {
    const recharts = await import('recharts');

    return {
      default: recharts[componentName] as React.ComponentType<RechartsComponentProps<K>>,
    };
  });

const LazyArea = lazyRechartsComponent('Area');
const LazyAreaChart = lazyRechartsComponent('AreaChart');
const LazyBar = lazyRechartsComponent('Bar');
const LazyBarChart = lazyRechartsComponent('BarChart');
const LazyCartesianGrid = lazyRechartsComponent('CartesianGrid');
const LazyLabelList = lazyRechartsComponent('LabelList');
const LazyLegend = lazyRechartsComponent('Legend');
const LazyReferenceLine = lazyRechartsComponent('ReferenceLine');
const LazyResponsiveContainer = lazyRechartsComponent('ResponsiveContainer');
const LazyTooltip = lazyRechartsComponent('Tooltip');
const LazyXAxis = lazyRechartsComponent('XAxis');
const LazyYAxis = lazyRechartsComponent('YAxis');

function Area(props: RechartsComponentProps<'Area'>) {
  return <LazyArea {...props} />;
}

function AreaChart(props: RechartsComponentProps<'AreaChart'>) {
  return <LazyAreaChart {...props} />;
}

function Bar(props: RechartsComponentProps<'Bar'>) {
  return <LazyBar {...props} />;
}

function BarChart(props: RechartsComponentProps<'BarChart'>) {
  return <LazyBarChart {...props} />;
}

function CartesianGrid(props: RechartsComponentProps<'CartesianGrid'>) {
  return <LazyCartesianGrid {...props} />;
}

function LabelList(props: RechartsComponentProps<'LabelList'>) {
  return <LazyLabelList {...props} />;
}

function ReferenceLine(props: RechartsComponentProps<'ReferenceLine'>) {
  return <LazyReferenceLine {...props} />;
}

function XAxis(props: RechartsComponentProps<'XAxis'>) {
  return <LazyXAxis {...props} />;
}

function YAxis(props: RechartsComponentProps<'YAxis'>) {
  return <LazyYAxis {...props} />;
}

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.use(ChartContext);

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: RechartsComponentProps<'ResponsiveContainer'>['children'];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;
  const contextValue = React.useMemo(() => ({ config }), [config]);

  return (
    <ChartContext.Provider value={contextValue}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <React.Suspense fallback={null}>
          <LazyResponsiveContainer initialDimension={initialDimension}>
            {children}
          </LazyResponsiveContainer>
        </React.Suspense>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, config]) => config.theme ?? config.color);
  const css = Object.entries(THEMES)
    .map(
      ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .flatMap(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return color ? [`  --color-${key}: ${color};`] : [];
  })
  .join('\n')}
}
`,
    )
    .join('\n');

  if (!colorConfig.length) {
    return null;
  }

  return <style>{css}</style>;
};

function ChartTooltip(props: RechartsComponentProps<'Tooltip'>) {
  return <LazyTooltip {...props} />;
}

function ChartTooltipContent({ active, payload, ...props }: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  return <ChartTooltipContentBody {...props} payload={payload} config={config} />;
}

const ChartTooltipContentBody = React.memo(function ChartTooltipContentBody({
  payload,
  config,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: Omit<ChartTooltipContentProps, 'active' | 'payload'> & {
  config: ChartConfig;
  payload: NonNullable<ChartTooltipContentProps['payload']>;
}) {
  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }

    if (!value) {
      return null;
    }

    return <div className={cn('font-medium', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          if (item.type === 'none') return null;
          const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color ?? item.payload?.fill ?? item.color;
          const itemKey = `${item.dataKey ?? item.name ?? key}-${item.value ?? indicatorColor ?? 'item'}`;

          return (
            <div
              key={itemKey}
              className={cn(
                'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground',
                indicator === 'dot' && 'items-center',
              )}
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn(
                          'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
                          {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent':
                              indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          },
                        )}
                        style={
                          {
                            '--color-bg': indicatorColor,
                            '--color-border': indicatorColor,
                          } as React.CSSProperties
                        }
                      />
                    )
                  )}
                  <div
                    className={cn(
                      'flex flex-1 justify-between leading-none',
                      nestLabel ? 'items-end' : 'items-center',
                    )}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">
                        {itemConfig?.label ?? item.name}
                      </span>
                    </div>
                    {item.value != null && (
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {typeof item.value === 'number'
                          ? item.value.toLocaleString()
                          : String(item.value)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function ChartLegend(props: RechartsComponentProps<'Legend'>) {
  return <LazyLegend {...props} />;
}

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean;
  nameKey?: string;
} & DefaultLegendContentProps) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload.map((item) => {
        if (item.type === 'none') return null;
        const key = `${nameKey ?? item.dataKey ?? 'value'}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);
        const itemKey = `${item.dataKey ?? item.value ?? key}-${item.color ?? itemConfig?.label ?? 'item'}`;

        return (
          <div
            key={itemKey}
            className={cn(
              'flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground',
            )}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="size-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const payloadPayload =
    'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
};
